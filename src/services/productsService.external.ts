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

    if (files.length === 0) {
        // Sin imágenes: JSON directo (multer del upstream ignora bodies no-multipart)
        const { data } = await axios.post(url, { ...fields, businessId }, cfg);
        return data;
    }

    // Con imágenes: FormData nativo de Node (>=18) — axios setea el boundary.
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
    patch: Record<string, unknown>
) {
    const { data } = await axios.patch(
        `${PRODUCTS_SERVICE_LINK}/product/${productId}`,
        patch,
        { timeout: 15000, headers: headers(businessId) }
    );
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
