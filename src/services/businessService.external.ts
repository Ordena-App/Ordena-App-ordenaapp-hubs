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
