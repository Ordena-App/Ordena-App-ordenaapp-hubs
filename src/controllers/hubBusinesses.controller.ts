import { Request, Response } from "express";
import hubModel from "../models/hubModel";
import {
    createHubBusiness,
    getBusinessesByHubId,
    assertBusinessBelongsToHub,
    patchBusinessInternal,
    getBusinessSettingsExternal,
    patchBusinessWeeklyHours,
    uploadBusinessLogoExternal,
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

        // Mora >= 15 días: se bloquea SOLO crear (negocios/usuarios) — la
        // operación pública y todo lo demás siguen intactos (decisión F3 v2).
        const pastDueSince = (hub.subscription as any)?.pastDueSince;
        if (pastDueSince && Date.now() - new Date(pastDueSince).getTime() > 15 * 24 * 60 * 60 * 1000) {
            return res.status(403).json({
                status: false,
                statusCode: 403,
                message: "Tu suscripción lleva más de 15 días con un pago pendiente. Actualiza tu método de pago en Plan para seguir creando.",
                data: { reason: "past_due_lock" },
            });
        }

        // Límites del plan (F3 v2: excedente SIN bloquear). Sobre
        // businessesIncluded se permite y se factura como negocio extra; solo
        // el hard cap (freno de emergencia contra abuso/mora) bloquea.
        const limits: any = hub.subscription?.limits || {};
        const included = limits.businessesIncluded ?? -1;
        const hardCap = limits.businessesHardCap ?? -1;
        const currentCount = hub.usageMetrics.businessesCount || 0;
        if (hardCap !== -1 && currentCount >= hardCap) {
            return res.status(403).json({
                status: false,
                statusCode: 403,
                message: `Alcanzaste el tope de ${hardCap} negocios. Contáctanos para ampliar tu plan.`,
                data: { hardCap, current: currentCount },
            });
        }
        const isExtraBusiness = included !== -1 && currentCount >= included;
        if (isExtraBusiness) {
            console.log(
                `[hub ${ctx.hubId}] negocio extra: ${currentCount + 1} de ${included} incluidos ` +
                "(se factura como excedente, no se bloquea)"
            );
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
            // Cohesión visual: la tienda del negocio hereda los colores del hub
            // desde el día 1 (si el negocio personaliza después, manda lo suyo).
            ...(hub.branding?.primaryColor
                ? {
                    branding: {
                        primaryColor: hub.branding.primaryColor,
                        primaryForeground: hub.branding.primaryForeground,
                    },
                }
                : {}),
            // Prefill del checkout: el negocio nace con la ubicación de entrega
            // por defecto del hub (deliveryDefaults), si el hub la configuró.
            ...(hub.deliveryDefaults?.state || hub.deliveryDefaults?.city
                ? {
                    default_delivery_location: {
                        state: hub.deliveryDefaults.state ?? null,
                        stateIso: hub.deliveryDefaults.stateIso ?? null,
                        city: hub.deliveryDefaults.city ?? null,
                    },
                }
                : {}),
            // Métodos de entrega del hub: el checkout nace ofreciendo lo que el
            // operador decidió (default: delivery + recogida, tarifa 0).
            fulfillment: {
                deliveryEnabled: hub.fulfillment?.deliveryEnabled !== false,
                pickupEnabled: hub.fulfillment?.pickupEnabled !== false,
                deliveryFee:
                    typeof hub.fulfillment?.deliveryFee === "number" && hub.fulfillment.deliveryFee >= 0
                        ? hub.fulfillment.deliveryFee
                        : 0,
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

/**
 * GET /api/hubs/me/businesses/:businessId — detalle para /hub-admin:
 * identidad pública del negocio + horario (businessHours con
 * allowSalesOutsideHours) leído de sus settings.
 */
export async function getMyHubBusinessDetail(req: Request, res: Response): Promise<Response> {
    const ctx = req.hubContext!;
    try {
        const businessId = String(req.params.businessId);
        const business = await assertBusinessBelongsToHub(ctx.hubId, businessId);
        let businessHours: unknown = null;
        try {
            const settingsResp = await getBusinessSettingsExternal(businessId);
            businessHours = settingsResp?.data?.businessHours ?? settingsResp?.businessHours ?? null;
        } catch (e: any) {
            console.error("[business-detail] settings fetch:", e?.response?.status || e?.message);
        }
        return res.status(200).json({
            status: true,
            statusCode: 200,
            message: "Detalle del negocio",
            data: {
                business: {
                    _id: business._id,
                    name: business.name,
                    hubSlug: business.hubSlug,
                    store_link: business.store_link,
                    image_url: business.image_url,
                    description: business.description,
                    industry: business.industry,
                    phone: business.phone,
                    address: business.address,
                    operationalStatus: business.operationalStatus || "active",
                },
                businessHours,
            },
        });
    } catch (error: any) {
        return upstreamError(res, error, "cargar el negocio");
    }
}

// Campos de identidad que el hub puede editar de sus negocios.
const BUSINESS_INFO_FIELDS = ["name", "description", "phone", "address"] as const;

/** PATCH /api/hubs/me/businesses/:businessId — info básica (vía patch interno). */
export async function updateMyHubBusinessInfo(req: Request, res: Response): Promise<Response> {
    const ctx = req.hubContext!;
    try {
        const businessId = String(req.params.businessId);
        await assertBusinessBelongsToHub(ctx.hubId, businessId);

        const patch: Record<string, unknown> = {};
        for (const f of BUSINESS_INFO_FIELDS) {
            if (typeof (req.body || {})[f] === "string") patch[f] = (req.body as any)[f];
        }
        if (Object.keys(patch).length === 0) {
            return res.status(400).json({
                status: false,
                statusCode: 400,
                message: "Nada que actualizar",
                data: {},
            });
        }
        const updated = await patchBusinessInternal(businessId, patch);
        return res.status(200).json({
            status: true,
            statusCode: 200,
            message: "Negocio actualizado",
            data: updated?.data ?? updated,
        });
    } catch (error: any) {
        return upstreamError(res, error, "actualizar el negocio");
    }
}

/** POST /api/hubs/me/businesses/:businessId/logo (multipart 'image'). */
export async function uploadMyHubBusinessLogo(req: Request, res: Response): Promise<Response> {
    const ctx = req.hubContext!;
    try {
        const businessId = String(req.params.businessId);
        await assertBusinessBelongsToHub(ctx.hubId, businessId);
        const file = (req as any).file as { buffer: Buffer; originalname: string; mimetype: string } | undefined;
        if (!file) {
            return res.status(400).json({
                status: false,
                statusCode: 400,
                message: "Archivo 'image' requerido",
                data: {},
            });
        }
        const resp = await uploadBusinessLogoExternal(businessId, file);
        return res.status(200).json(resp);
    } catch (error: any) {
        return upstreamError(res, error, "subir el logo");
    }
}

/**
 * PATCH /api/hubs/me/businesses/:businessId/hours
 * Body: { timezone?, weeklyHours?, allowSalesOutsideHours? } — mismo contrato
 * que el endpoint hours/weekly de business (valida overnight, solapes, etc.).
 */
export async function updateMyHubBusinessHours(req: Request, res: Response): Promise<Response> {
    const ctx = req.hubContext!;
    try {
        const businessId = String(req.params.businessId);
        await assertBusinessBelongsToHub(ctx.hubId, businessId);
        const { timezone, weeklyHours, allowSalesOutsideHours } = req.body || {};
        const resp = await patchBusinessWeeklyHours(businessId, {
            ...(timezone !== undefined ? { timezone } : {}),
            ...(weeklyHours !== undefined ? { weeklyHours } : {}),
            ...(typeof allowSalesOutsideHours === "boolean" ? { allowSalesOutsideHours } : {}),
        });
        return res.status(200).json(resp);
    } catch (error: any) {
        // Las validaciones de horario del upstream (400) traen mensajes útiles.
        const st = error?.response?.status;
        if (st && st >= 400 && st < 500 && error?.response?.data) {
            return res.status(st).json(error.response.data);
        }
        return upstreamError(res, error, "guardar el horario");
    }
}
