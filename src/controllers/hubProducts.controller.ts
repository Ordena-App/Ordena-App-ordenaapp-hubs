import { Request, Response } from "express";
import { assertBusinessBelongsToHub } from "../services/businessService.external";
import {
    listBusinessProducts,
    createBusinessProduct,
    updateBusinessProduct,
    deleteBusinessProduct,
    setProductHubCategoriesExternal,
    getProductByIdExternal,
    UploadedFile,
    listBusinessCategoriesExternal,
    listPackageTemplatesExternal,
    listBusinessProvidersExternal,
    createBusinessProviderExternal,
    createBusinessCategoryExternal,
} from "../services/productsService.external";

// Gestión de productos de los negocios del hub (F2.1). Regla de oro intacta:
// TODA operación valida pertenencia hub→negocio antes de tocar products.

function upstreamError(res: Response, error: any, action: string): Response {
    if (error?.code === "BUSINESS_NOT_IN_HUB") {
        return res.status(403).json({
            status: false,
            statusCode: 403,
            message: "El negocio no pertenece a este hub",
            data: {},
        });
    }
    const upstreamStatus = error?.response?.status;
    // 4xx del upstream traen validaciones útiles (límites, precio inválido…)
    if (upstreamStatus && upstreamStatus >= 400 && upstreamStatus < 500 && error?.response?.data) {
        return res.status(upstreamStatus).json(error.response.data);
    }
    console.error(`Error en ${action}:`, error?.response?.data || error?.message || error);
    return res.status(502).json({
        status: false,
        statusCode: 502,
        message: `No se pudo ${action} (products-service respondió ${upstreamStatus ?? "sin conexión"})`,
        data: {},
    });
}

/**
 * Candado extra: el producto DEBE pertenecer al negocio indicado. products ya
 * acota sus mutaciones por x-business-id, pero validar aquí evita depender de
 * una sola capa y devuelve un 403 claro en vez de un 404 confuso.
 */
async function assertProductBelongsToBusiness(businessId: string, productId: string): Promise<void> {
    let product: any = null;
    try {
        const resp = await getProductByIdExternal(businessId, productId);
        product = resp?.data?.product ?? resp?.data ?? resp?.product ?? resp ?? null;
    } catch {
        product = null;
    }
    const ownerId = product && (product.businessId ?? product?.data?.businessId);
    if (!ownerId || String(ownerId) !== String(businessId)) {
        const err: any = new Error("product_not_in_business");
        err.response = {
            status: 403,
            data: { status: false, statusCode: 403, message: "El producto no pertenece a este negocio", data: {} },
        };
        throw err;
    }
}

/** GET /api/hubs/me/businesses/:businessId/products?page=&limit=&name= */
export async function getMyBusinessProducts(req: Request, res: Response): Promise<Response> {
    const ctx = req.hubContext!;
    try {
        const businessId = String(req.params.businessId);
        await assertBusinessBelongsToHub(ctx.hubId, businessId);
        const resp = await listBusinessProducts(businessId, {
            page: Number(req.query.page) || 1,
            limit: Number(req.query.limit) || 50,
            name: typeof req.query.name === "string" ? req.query.name : undefined,
        });
        return res.status(200).json(resp);
    } catch (error: any) {
        return upstreamError(res, error, "listar los productos");
    }
}

// Editor 1:1 con el dashboard clásico: el body pasa COMPLETO al upstream
// (variantes, combinaciones, packaging, price_tiers, SEO, promociones…).
// Solo se excluyen los campos de control del tenant: businessId lo fuerza el
// proxy y hubCategoryIds tiene su propio endpoint interno con validación.
const BLOCKED_FIELDS = new Set(["businessId", "hubId", "hubCategoryIds", "hub_id"]);

function passThroughBody(body: Record<string, unknown> | undefined): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    if (!body) return out;
    for (const [key, value] of Object.entries(body)) {
        if (BLOCKED_FIELDS.has(key)) continue;
        if (value !== undefined) out[key] = value;
    }
    return out;
}

/** POST /api/hubs/me/businesses/:businessId/products (multipart: hasta 4 'images' opcionales) */
export async function createMyBusinessProduct(req: Request, res: Response): Promise<Response> {
    const ctx = req.hubContext!;
    try {
        const businessId = String(req.params.businessId);
        await assertBusinessBelongsToHub(ctx.hubId, businessId);

        const fields = passThroughBody(req.body);
        if (!fields.name || fields.price === undefined) {
            return res.status(400).json({
                status: false,
                statusCode: 400,
                message: "name y price son requeridos",
                data: {},
            });
        }
        // track_stock SIEMPRE explícito: con stock => se controla inventario;
        // sin stock => ilimitado. (products default a true + stock 0 = producto
        // agotado desde su creación, que es lo contrario de "Stock (opcional)".)
        if (fields.track_stock === undefined) {
            fields.track_stock = fields.stock !== undefined ? "true" : "false";
        }

        const files: UploadedFile[] = Array.isArray((req as any).files)
            ? ((req as any).files as UploadedFile[])
            : [];

        const resp = await createBusinessProduct(businessId, fields, files);
        return res.status(201).json(resp);
    } catch (error: any) {
        return upstreamError(res, error, "crear el producto");
    }
}

/** PATCH /api/hubs/me/businesses/:businessId/products/:productId */
export async function updateMyBusinessProduct(req: Request, res: Response): Promise<Response> {
    const ctx = req.hubContext!;
    try {
        const businessId = String(req.params.businessId);
        const productId = String(req.params.productId);
        await assertBusinessBelongsToHub(ctx.hubId, businessId);
        await assertProductBelongsToBusiness(businessId, productId);

        const patch = passThroughBody(req.body);
        const files: UploadedFile[] = Array.isArray((req as any).files)
            ? ((req as any).files as UploadedFile[])
            : [];
        if (Object.keys(patch).length === 0 && files.length === 0) {
            return res.status(400).json({
                status: false,
                statusCode: 400,
                message: "Nada que actualizar",
                data: {},
            });
        }

        const resp = await updateBusinessProduct(businessId, productId, patch, files);
        return res.status(200).json(resp);
    } catch (error: any) {
        return upstreamError(res, error, "actualizar el producto");
    }
}

/** DELETE /api/hubs/me/businesses/:businessId/products/:productId */
export async function deleteMyBusinessProduct(req: Request, res: Response): Promise<Response> {
    const ctx = req.hubContext!;
    try {
        const businessId = String(req.params.businessId);
        const productId = String(req.params.productId);
        await assertBusinessBelongsToHub(ctx.hubId, businessId);
        await assertProductBelongsToBusiness(businessId, productId);
        const resp = await deleteBusinessProduct(businessId, productId);
        return res.status(200).json(resp);
    } catch (error: any) {
        return upstreamError(res, error, "eliminar el producto");
    }
}

/** PATCH /api/hubs/me/products/:productId/hub-categories  Body: { hubCategoryIds: string[] } */
export async function setMyProductHubCategories(req: Request, res: Response): Promise<Response> {
    const ctx = req.hubContext!;
    try {
        const productId = String(req.params.productId);
        const raw = (req.body || {}).hubCategoryIds;
        if (!Array.isArray(raw)) {
            return res.status(400).json({
                status: false,
                statusCode: 400,
                message: "hubCategoryIds debe ser un array",
                data: {},
            });
        }
        // products re-valida producto→negocio→hub con ctx.hubId (defensa en profundidad)
        const resp = await setProductHubCategoriesExternal(ctx.hubId, productId, raw.map(String));
        return res.status(200).json(resp);
    } catch (error: any) {
        return upstreamError(res, error, "asignar las categorías");
    }
}


/**
 * GET /api/hubs/me/businesses/:businessId/categories
 * Categorías internas del negocio (para asignarlas al crear/editar productos
 * desde el hub — mismas categorías que usa el storefront clásico del negocio).
 */
export async function getMyBusinessCategories(req: Request, res: Response): Promise<Response> {
    const ctx = req.hubContext!;
    try {
        const businessId = String(req.params.businessId);
        await assertBusinessBelongsToHub(ctx.hubId, businessId);
        const categories = await listBusinessCategoriesExternal(businessId);
        return res.status(200).json({
            status: true,
            statusCode: 200,
            message: "Categorías del negocio",
            data: { categories },
        });
    } catch (error: any) {
        if (error?.code === "BUSINESS_NOT_IN_HUB") {
            return res.status(403).json({ status: false, statusCode: 403, message: "El negocio no pertenece a este hub", data: {} });
        }
        console.error("Error listando categorías del negocio:", error?.response?.data || error?.message || error);
        return res.status(502).json({ status: false, statusCode: 502, message: "No se pudieron cargar las categorías", data: {} });
    }
}


// ── Editor 1:1: recursos auxiliares del negocio (respuesta upstream VERBATIM) ──

/** GET /api/hubs/me/businesses/:businessId/package-templates */
export async function getMyBusinessPackageTemplates(req: Request, res: Response): Promise<Response> {
    const ctx = req.hubContext!;
    try {
        const businessId = String(req.params.businessId);
        await assertBusinessBelongsToHub(ctx.hubId, businessId);
        const data = await listPackageTemplatesExternal(businessId);
        return res.status(200).json(data);
    } catch (error: any) {
        return upstreamError(res, error, "cargar las plantillas de empaque");
    }
}

/** GET /api/hubs/me/businesses/:businessId/providers */
export async function getMyBusinessProviders(req: Request, res: Response): Promise<Response> {
    const ctx = req.hubContext!;
    try {
        const businessId = String(req.params.businessId);
        await assertBusinessBelongsToHub(ctx.hubId, businessId);
        const data = await listBusinessProvidersExternal(businessId);
        return res.status(200).json(data);
    } catch (error: any) {
        return upstreamError(res, error, "cargar los proveedores");
    }
}

/** POST /api/hubs/me/businesses/:businessId/providers */
export async function createMyBusinessProvider(req: Request, res: Response): Promise<Response> {
    const ctx = req.hubContext!;
    try {
        const businessId = String(req.params.businessId);
        await assertBusinessBelongsToHub(ctx.hubId, businessId);
        const data = await createBusinessProviderExternal(businessId, passThroughBody(req.body));
        return res.status(201).json(data);
    } catch (error: any) {
        return upstreamError(res, error, "crear el proveedor");
    }
}

/** POST /api/hubs/me/businesses/:businessId/categories (multipart: 'image' opcional) */
export async function createMyBusinessCategory(req: Request, res: Response): Promise<Response> {
    const ctx = req.hubContext!;
    try {
        const businessId = String(req.params.businessId);
        await assertBusinessBelongsToHub(ctx.hubId, businessId);
        const files: UploadedFile[] = Array.isArray((req as any).files)
            ? ((req as any).files as UploadedFile[])
            : [];
        const data = await createBusinessCategoryExternal(businessId, passThroughBody(req.body), files);
        return res.status(201).json(data);
    } catch (error: any) {
        return upstreamError(res, error, "crear la categoría");
    }
}
