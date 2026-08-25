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

// Campos que el hub puede definir al crear/editar. Variantes, combinaciones,
// promociones y demás avanzado quedan para el editor completo (post-MVP).
const CREATE_FIELDS = ["name", "price", "stock", "description", "sku", "track_stock"] as const;
const UPDATE_FIELDS = ["name", "price", "stock", "description", "sku", "track_stock", "isActive"] as const;

/** POST /api/hubs/me/businesses/:businessId/products (multipart: hasta 4 'images' opcionales) */
export async function createMyBusinessProduct(req: Request, res: Response): Promise<Response> {
    const ctx = req.hubContext!;
    try {
        const businessId = String(req.params.businessId);
        await assertBusinessBelongsToHub(ctx.hubId, businessId);

        const fields: Record<string, unknown> = {};
        for (const f of CREATE_FIELDS) {
            if (req.body && req.body[f] !== undefined && req.body[f] !== "") fields[f] = req.body[f];
        }
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

        // `!== undefined` (no truthy): así un string vacío SÍ limpia el campo
        // — antes la descripción no se podía borrar desde /hub-admin.
        const patch: Record<string, unknown> = {};
        for (const f of UPDATE_FIELDS) {
            if (req.body && req.body[f] !== undefined) patch[f] = req.body[f];
        }
        if (Object.keys(patch).length === 0) {
            return res.status(400).json({
                status: false,
                statusCode: 400,
                message: "Nada que actualizar",
                data: {},
            });
        }

        const resp = await updateBusinessProduct(businessId, productId, patch);
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
