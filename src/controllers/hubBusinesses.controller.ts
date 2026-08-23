import { Request, Response } from "express";
import hubModel from "../models/hubModel";
import {
    createHubBusiness,
    getBusinessesByHubId,
    assertBusinessBelongsToHub,
    patchBusinessInternal,
} from "../services/businessService.external";

// Traduce fallos del upstream (business-service) a respuestas claras.
// Mientras el contrato F1 no esté desplegado allá, los 404 upstream se
// reportan como 502 con mensaje explícito — nunca como "no hay negocios".
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
    console.error(`Error en ${action}:`, error?.response?.data || error?.message || error);
    return res.status(502).json({
        status: false,
        statusCode: 502,
        message: `No se pudo ${action} (business-service respondió ${upstreamStatus ?? "sin conexión"})`,
        data: {},
    });
}

/**
 * POST /api/hubs/me/businesses  (HUB_OWNER/HUB_ADMIN)
 * Crea un negocio administrado por el hub (context HUB_MANAGED en business).
 * No requiere que el dueño del negocio tenga cuenta de Ordena.
 */
export async function createBusinessForMyHub(req: Request, res: Response): Promise<Response> {
    const ctx = req.hubContext!;
    try {
        const { name, slug, description, industry, country_code, phone, email, address, region_settings } = req.body || {};
        if (!name || !industry || !country_code || !phone) {
            return res.status(400).json({
                status: false,
                statusCode: 400,
                message: "name, industry, country_code y phone son requeridos",
                data: {},
            });
        }

        const hub = await hubModel.findById(ctx.hubId);
        if (!hub) {
            return res.status(404).json({
                status: false,
                statusCode: 404,
                message: "Hub no encontrado",
                data: {},
            });
        }

        // Límite comercial del plan (businessesIncluded; -1 = ilimitado).
        const limit = hub.subscription?.limits?.businessesIncluded ?? -1;
        if (limit !== -1 && hub.usageMetrics.businessesCount >= limit) {
            return res.status(403).json({
                status: false,
                statusCode: 403,
                message: `Alcanzaste el límite de ${limit} negocios de tu plan. Mejora tu plan para agregar más.`,
                data: { limit, current: hub.usageMetrics.businessesCount },
            });
        }

        const created = await createHubBusiness({
            hubId: ctx.hubId,
            name,
            slug,
            description,
            industry,
            country_code,
            phone,
            email,
            address,
            region_settings: region_settings || {
                country: hub.country,
                currency: hub.currency,
                language: hub.language,
            },
        });

        await hubModel.updateOne(
            { _id: ctx.hubId },
            { $inc: { "usageMetrics.businessesCount": 1 }, $set: { updated_at: new Date() } }
        );

        return res.status(201).json({
            status: true,
            statusCode: 201,
            message: "Negocio creado correctamente",
            data: created?.data ?? created,
        });
    } catch (error: any) {
        return upstreamError(res, error, "crear el negocio");
    }
}

/** GET /api/hubs/me/businesses — listado de negocios del hub. */
export async function getMyHubBusinesses(req: Request, res: Response): Promise<Response> {
    const ctx = req.hubContext!;
    try {
        const resp = await getBusinessesByHubId(ctx.hubId);
        return res.status(200).json({
            status: true,
            statusCode: 200,
            message: "Negocios del hub",
            data: resp?.data ?? resp,
        });
    } catch (error: any) {
        return upstreamError(res, error, "listar los negocios");
    }
}

/**
 * PATCH /api/hubs/me/businesses/:businessId/operational-status  (roles de hub)
 * Cambia el estado operativo del negocio: active | paused | temporarily_closed.
 * "paused" = dentro de horario pero sin aceptar pedidos (ej. saturación).
 */
export async function updateBusinessOperationalStatus(req: Request, res: Response): Promise<Response> {
    const ctx = req.hubContext!;
    try {
        const businessId = String(req.params.businessId);
        const { operationalStatus } = req.body || {};
        const allowed = ["active", "paused", "temporarily_closed"];
        if (!allowed.includes(operationalStatus)) {
            return res.status(400).json({
                status: false,
                statusCode: 400,
                message: `operationalStatus debe ser uno de: ${allowed.join(", ")}`,
                data: {},
            });
        }

        // Candado de pertenencia: SIEMPRE antes de tocar el negocio.
        await assertBusinessBelongsToHub(ctx.hubId, businessId);

        const updated = await patchBusinessInternal(businessId, { operationalStatus });
        return res.status(200).json({
            status: true,
            statusCode: 200,
            message: "Estado operativo actualizado",
            data: updated?.data ?? updated,
        });
    } catch (error: any) {
        return upstreamError(res, error, "actualizar el estado del negocio");
    }
}
