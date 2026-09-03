import axios from "axios";
import { BUSINESS_SERVICE_LINK, INTERNAL_SHARED_SECRET } from "../config/config";

// ============================================================================
// Contrato F1 con business-service (server-to-server).
//
// Estos endpoints son la contraparte que business-service debe exponer para el
// Modo Multi-Negocio (espejo del patrón agencies: GET /businesses/agency/:id).
// Hasta que aterricen, las llamadas devuelven el error del upstream tal cual —
// el controller lo traduce a un 502 explicativo.
//
//   POST  /business/hub-managed          → crea Business con context HUB_MANAGED,
//                                          hubId, planRef.kind HUB_PLAN. No exige
//                                          cuenta Firebase del dueño.
//   GET   /businesses/hub/:hubId         → lista businesses del hub (proyección
//                                          ligera: nombre, slug, logo, status,
//                                          horario resumido).
//   PATCH /business/:id/internal         → ya EXISTE: actualizaciones internas
//                                          (status operativo, etc.).
// ============================================================================

function internalHeaders(extra?: Record<string, string>) {
    return {
        ...(INTERNAL_SHARED_SECRET ? { "x-ordena-secret": INTERNAL_SHARED_SECRET } : {}),
        ...(extra || {}),
    };
}

export interface CreateHubBusinessPayload {
    hubId: string;
    name: string;
    slug?: string;
    description?: string;
    industry: string;
    country_code: string;
    phone: string;
    email?: string;
    address?: string;
    region_settings: { country: string; currency: string; language?: "ES" | "EN" };
    /** Branding del hub: el storefront del negocio nace con estos colores. */
    branding?: { primaryColor?: string; primaryForeground?: string };
    /** deliveryDefaults del hub: el checkout del negocio nace con este prefill. */
    default_delivery_location?: { state?: string | null; stateIso?: string | null; city?: string | null };
    /** fulfillment del hub: métodos de entrega y tarifa con los que nace el checkout. */
    fulfillment?: { deliveryEnabled?: boolean; pickupEnabled?: boolean; deliveryFee?: number };
}

export async function createHubBusiness(payload: CreateHubBusinessPayload) {
    const { data } = await axios.post(
        `${BUSINESS_SERVICE_LINK}/business/hub-managed`,
        payload,
        { timeout: 15000, headers: internalHeaders() }
    );
    return data;
}

export async function getBusinessesByHubId(hubId: string) {
    const { data } = await axios.get(
        `${BUSINESS_SERVICE_LINK}/businesses/hub/${hubId}`,
        { timeout: 15000, headers: internalHeaders() }
    );
    return data;
}

export async function getBusinessById(businessId: string) {
    const { data } = await axios.get(
        `${BUSINESS_SERVICE_LINK}/business/${businessId}`,
        { timeout: 15000, headers: internalHeaders({ "x-business-id": businessId }) }
    );
    return data;
}

/**
 * Verificación de pertenencia hub ↔ business. TODA operación sobre un negocio
 * debe pasar por aquí antes de tocar/leer nada: es la garantía de que nunca se
 * expone información entre negocios ni entre hubs.
 */
export async function assertBusinessBelongsToHub(hubId: string, businessId: string): Promise<any> {
    const resp = await getBusinessById(businessId);
    // GET /business/:id devuelve el negocio SIN wrapper ({_id, name, hubId...});
    // toleramos también shapes envueltos por si el upstream cambia.
    const raw = resp?.data?.business ?? resp?.business ?? resp?.data ?? resp ?? null;
    const business = raw && raw._id ? raw : null;
    const businessHubId = business?.hubId ? String(business.hubId) : null;
    if (!business || businessHubId !== String(hubId)) {
        const err: any = new Error("business_not_in_hub");
        err.code = "BUSINESS_NOT_IN_HUB";
        throw err;
    }
    return business;
}

export async function patchBusinessInternal(businessId: string, patch: Record<string, unknown>) {
    const { data } = await axios.patch(
        `${BUSINESS_SERVICE_LINK}/business/${businessId}/internal`,
        patch,
        { timeout: 15000, headers: internalHeaders({ "x-business-id": businessId }) }
    );
    return data;
}

export async function getBusinessSettingsExternal(businessId: string) {
    const { data } = await axios.get(
        `${BUSINESS_SERVICE_LINK}/business-settings/${businessId}`,
        { timeout: 15000, headers: internalHeaders({ "x-business-id": businessId }) }
    );
    return data;
}

/** PATCH horario semanal (+ timezone y allowSalesOutsideHours) del negocio. */
export async function patchBusinessWeeklyHours(
    businessId: string,
    body: { timezone?: string; weeklyHours?: unknown[]; allowSalesOutsideHours?: boolean }
) {
    const { data } = await axios.patch(
        `${BUSINESS_SERVICE_LINK}/business-settings/${businessId}/hours/weekly`,
        body,
        { timeout: 15000, headers: internalHeaders({ "x-business-id": businessId }) }
    );
    return data;
}

/** Sube el logo del negocio (endpoint interno hub-logo; FormData nativo Node >= 18). */
export async function uploadBusinessLogoExternal(
    businessId: string,
    file: { buffer: Buffer; originalname: string; mimetype: string }
) {
    const FormDataCtor: any = (globalThis as any).FormData;
    if (!FormDataCtor) throw new Error("Node >= 18 requerido para subir imágenes");
    const { Blob } = require("buffer");
    const fd = new FormDataCtor();
    fd.append("image", new Blob([file.buffer as unknown as ArrayBuffer], { type: file.mimetype }), file.originalname);
    const { data } = await axios.patch(
        `${BUSINESS_SERVICE_LINK}/business/${businessId}/hub-logo`,
        fd,
        { timeout: 30000, headers: internalHeaders({ "x-business-id": businessId }) }
    );
    return data;
}


/**
 * Propaga el branding del hub al tema del storefront de TODOS sus negocios
 * (storefrontButtonTheme.global). Complemento de la siembra al crear: cubre
 * negocios anteriores a la siembra y cambios de color posteriores del hub.
 */
export async function propagateHubStorefrontThemeExternal(
    hubId: string,
    body: { primaryColor: string; primaryForeground?: string }
) {
    const { data } = await axios.patch(
        `${BUSINESS_SERVICE_LINK}/businesses/hub/${hubId}/storefront-theme`,
        body,
        { timeout: 20000, headers: internalHeaders() }
    );
    return data;
}

/**
 * Propaga la ubicación de entrega por defecto del hub (deliveryDefaults) a
 * delivery_options.default_delivery_location de TODOS sus negocios. Con body
 * vacío limpia el prefill. Complemento de la siembra al crear.
 */
export async function propagateHubDeliveryDefaultsExternal(
    hubId: string,
    body: { state?: string | null; stateIso?: string | null; city?: string | null }
) {
    const { data } = await axios.patch(
        `${BUSINESS_SERVICE_LINK}/businesses/hub/${hubId}/delivery-defaults`,
        body,
        { timeout: 20000, headers: internalHeaders() }
    );
    return data;
}

/**
 * Propaga los métodos de entrega del hub (fulfillment) al checkout de TODOS
 * sus negocios: delivery_options.{own_delivery, onSite, delivery(tarifa)}.
 */
export async function propagateHubFulfillmentExternal(
    hubId: string,
    body: { deliveryEnabled: boolean; pickupEnabled: boolean; deliveryFee: number }
) {
    const { data } = await axios.patch(
        `${BUSINESS_SERVICE_LINK}/businesses/hub/${hubId}/fulfillment`,
        body,
        { timeout: 20000, headers: internalHeaders() }
    );
    return data;
}

// ── Dominio custom del hub (F4): proxies de Vercel via business ──
export async function addHubDomainExternal(domain: string) {
    const { data } = await axios.post(
        `${BUSINESS_SERVICE_LINK}/internal/hub-domains`,
        { domain },
        { timeout: 20000, headers: internalHeaders() }
    );
    return data;
}

export async function hubDomainStatusExternal(domain: string) {
    const { data } = await axios.get(`${BUSINESS_SERVICE_LINK}/internal/hub-domains/status`, {
        timeout: 20000,
        headers: internalHeaders(),
        params: { domain },
    });
    return data;
}
