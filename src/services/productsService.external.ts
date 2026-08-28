import axios from "axios";
import { Blob } from "buffer";
import { PRODUCTS_SERVICE_LINK, INTERNAL_SHARED_SECRET } from "../config/config";

// Server-to-server hacia products-service para la gestión de productos de los
// negocios del hub (F2.1 — cierra el gap: los negocios hub no tienen login
// Firebase, así que el hub administra sus productos desde /hub-admin).
//
// products-service exige el header x-business-id (presencia) y aplica sus
// propios gates de plan (skusLimit permisivo -1 en negocios hub). La
// pertenencia hub→negocio la valida el CONTROLLER de hubs antes de llamar.

function headers(businessId: string) {
    return { "x-business-id": businessId };
}

export async function listBusinessProducts(
    businessId: string,
    params?: { page?: number; limit?: number; name?: string }
) {
    const { data } = await axios.get(
        `${PRODUCTS_SERVICE_LINK}/productbusiness-admin/${businessId}`,
        { params, timeout: 15000, headers: headers(businessId) }
    );
    return data;
}

export interface UploadedFile {
    buffer: Buffer;
    originalname: string;
    mimetype: string;
}

/** Lee un producto por id (para validar su pertenencia al negocio). */
export async function getProductByIdExternal(businessId: string, productId: string) {
    const { data } = await axios.get(`${PRODUCTS_SERVICE_LINK}/product/${productId}`, {
        timeout: 15000,
        headers: headers(businessId),
    });
    return data;
}

export async function createBusinessProduct(
    businessId: string,
    fields: Record<string, unknown>,
    files: UploadedFile[]
) {
    const url = `${PRODUCTS_SERVICE_LINK}/product`;
    const cfg = { timeout: 30000, headers: headers(businessId) };

    // SIEMPRE multipart: es la única ruta que el dashboard clásico ejercita en
    // el upstream (multer + campos string). La variante JSON quedaba sin probar
    // y se comportaba distinto con los campos JSON-string (variants, options…).
    const FormDataCtor: any = (globalThis as any).FormData;
    if (!FormDataCtor) {
        throw new Error("Node >= 18 requerido para subir imágenes (FormData nativo)");
    }
    const fd = new FormDataCtor();
    fd.append("businessId", businessId);
    for (const [key, value] of Object.entries(fields)) {
        if (value !== undefined && value !== null) fd.append(key, String(value));
    }
    for (const f of files) {
        // Cast: Buffer es ArrayBufferLike y el tipado estricto de Blob pide
        // ArrayBuffer exacto; en runtime es válido.
        fd.append("images", new Blob([f.buffer as unknown as ArrayBuffer], { type: f.mimetype }), f.originalname);
    }
    const { data } = await axios.post(url, fd, cfg);
    return data;
}

export async function updateBusinessProduct(
    businessId: string,
    productId: string,
    patch: Record<string, unknown>,
    files: UploadedFile[] = []
) {
    const url = `${PRODUCTS_SERVICE_LINK}/product/${productId}`;
    const cfg = { timeout: 30000, headers: headers(businessId) };
    // SIEMPRE multipart (misma razón que en create): paridad exacta con la
    // ruta del dashboard clásico. El upstream parsea los campos como strings.
    const FormDataCtor: any = (globalThis as any).FormData;
    if (!FormDataCtor) {
        throw new Error("Node >= 18 requerido (FormData nativo)");
    }
    const fd = new FormDataCtor();
    for (const [key, value] of Object.entries(patch)) {
        if (value !== undefined && value !== null) fd.append(key, String(value));
    }
    for (const f of files) {
        fd.append("newImages", new Blob([f.buffer as unknown as ArrayBuffer], { type: f.mimetype }), f.originalname);
    }
    const { data } = await axios.patch(url, fd, cfg);
    return data;
}

export async function deleteBusinessProduct(businessId: string, productId: string) {
    const { data } = await axios.delete(
        `${PRODUCTS_SERVICE_LINK}/product/${productId}`,
        { timeout: 15000, headers: headers(businessId) }
    );
    return data;
}

/**
 * Tagging de categorías globales. El endpoint interno de products re-valida la
 * cadena producto→negocio→hub (defensa en profundidad).
 */
export async function setProductHubCategoriesExternal(
    hubId: string,
    productId: string,
    hubCategoryIds: string[]
) {
    const { data } = await axios.patch(
        `${PRODUCTS_SERVICE_LINK}/internal/hub/${hubId}/product/${productId}/hub-categories`,
        { hubCategoryIds },
        {
            timeout: 15000,
            headers: INTERNAL_SHARED_SECRET ? { "x-ordena-secret": INTERNAL_SHARED_SECRET } : {},
        }
    );
    return data;
}


/** Categorías INTERNAS del negocio (colección category del ms products). */
export async function listBusinessCategoriesExternal(businessId: string) {
    const { data } = await axios.get(`${PRODUCTS_SERVICE_LINK}/categorybussiness/${businessId}`, {
        timeout: 15000,
        headers: headers(businessId),
    });
    // El upstream devuelve el array pelado (o {message} cuando no hay ninguna).
    return Array.isArray(data) ? data : [];
}


// ── Editor 1:1 (paridad con el dashboard clásico) ──
// Estos proxies devuelven el cuerpo del upstream VERBATIM: el adaptador del
// frontend replica las mismas formas que las funciones de routes.ts del SaaS.

/** Plantillas de empaque del negocio (envíos). */
export async function listPackageTemplatesExternal(businessId: string) {
    const { data } = await axios.get(`${PRODUCTS_SERVICE_LINK}/package-templates`, {
        timeout: 15000,
        headers: headers(businessId),
        params: { businessId },
    });
    return data;
}

/** Proveedores del negocio. */
export async function listBusinessProvidersExternal(businessId: string) {
    const { data } = await axios.get(`${PRODUCTS_SERVICE_LINK}/providerbusiness/${businessId}`, {
        timeout: 15000,
        headers: headers(businessId),
    });
    return data;
}

/** Crear proveedor (JSON; el logo es opcional y el editor no lo manda). */
export async function createBusinessProviderExternal(businessId: string, body: Record<string, unknown>) {
    const { data } = await axios.post(
        `${PRODUCTS_SERVICE_LINK}/provider`,
        { ...body, businessId },
        { timeout: 15000, headers: headers(businessId) }
    );
    return data;
}

/** Crear categoría interna del negocio (multipart: imagen opcional). */
export async function createBusinessCategoryExternal(
    businessId: string,
    fields: Record<string, unknown>,
    files: UploadedFile[]
) {
    const url = `${PRODUCTS_SERVICE_LINK}/category`;
    const cfg = { timeout: 20000, headers: headers(businessId) };
    if (files.length === 0) {
        const { data } = await axios.post(url, { ...fields, businessId }, cfg);
        return data;
    }
    const FormDataCtor: any = (globalThis as any).FormData;
    const fd = new FormDataCtor();
    fd.append("businessId", businessId);
    for (const [key, value] of Object.entries(fields)) {
        if (value !== undefined && value !== null) fd.append(key, String(value));
    }
    for (const f of files) {
        fd.append("image", new Blob([f.buffer as unknown as ArrayBuffer], { type: f.mimetype }), f.originalname);
    }
    const { data } = await axios.post(url, fd, cfg);
    return data;
}
