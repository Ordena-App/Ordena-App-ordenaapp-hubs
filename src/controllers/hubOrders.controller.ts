import { Request, Response } from "express";
import hubModel from "../models/hubModel";
import { getHubOrders, getHubOrdersSummary, updateHubOrderStatus } from "../services/ordersService.external";
import { getBusinessesByHubId, assertBusinessBelongsToHub } from "../services/businessService.external";
import { resolveScopedBusinessId } from "../utils/auth";

function upstreamError(res: Response, error: any, action: string): Response {
    const upstreamStatus = error?.response?.status;
    if (upstreamStatus === 404 && error?.response?.data?.message) {
        return res.status(404).json(error.response.data);
    }
    console.error(`Error en ${action}:`, error?.response?.data || error?.message || error);
    return res.status(502).json({
        status: false,
        statusCode: 502,
        message: `No se pudo ${action} (orders-service respondió ${upstreamStatus ?? "sin conexión"})`,
        data: {},
    });
}

/**
 * GET /api/hubs/me/orders — pedidos consolidados del hub.
 * Filtros: businessId, status, from, to, page, limit.
 * BUSINESS_VIEWER queda SIEMPRE limitado a su negocio (scope del token).
 */
export async function getMyHubOrders(req: Request, res: Response): Promise<Response> {
    const ctx = req.hubContext!;
    try {
        const requested = typeof req.query.businessId === "string" ? req.query.businessId : undefined;
        const scoped = resolveScopedBusinessId(ctx, requested);
        if (ctx.role === "BUSINESS_VIEWER" && !scoped) {
            return res.status(403).json({
                status: false,
                statusCode: 403,
                message: "No tienes acceso a ese negocio",
                data: {},
            });
        }

        const resp = await getHubOrders(ctx.hubId, {
            page: Number(req.query.page) || 1,
            limit: Number(req.query.limit) || 20,
            businessId: scoped || undefined,
            status: typeof req.query.status === "string" ? req.query.status : undefined,
            from: typeof req.query.from === "string" ? req.query.from : undefined,
            to: typeof req.query.to === "string" ? req.query.to : undefined,
        });
        return res.status(200).json(resp);
    } catch (error: any) {
        return upstreamError(res, error, "listar los pedidos");
    }
}

/**
 * PATCH /api/hubs/me/orders/:orderId/status
 * Body: { order_status?, payment_status? }
 * Roles de hub cambian cualquier pedido del hub; BUSINESS_VIEWER solo los de
 * SU negocio (el filtro viaja a orders y se re-valida allá).
 */
export async function updateMyHubOrderStatus(req: Request, res: Response): Promise<Response> {
    const ctx = req.hubContext!;
    try {
        const orderId = String(req.params.orderId);
        const { order_status, payment_status } = req.body || {};
        const scopedBusinessId = ctx.role === "BUSINESS_VIEWER" ? ctx.businessId || undefined : undefined;
        if (ctx.role === "BUSINESS_VIEWER" && !scopedBusinessId) {
            return res.status(403).json({
                status: false,
                statusCode: 403,
                message: "No tienes acceso a este pedido",
                data: {},
            });
        }

        const resp = await updateHubOrderStatus(ctx.hubId, orderId, {
            order_status,
            payment_status,
            businessId: scopedBusinessId,
        });
        return res.status(200).json(resp);
    } catch (error: any) {
        return upstreamError(res, error, "actualizar el pedido");
    }
}

/**
 * GET /api/hubs/me/portal/summary?from=&to=[&businessId=]
 * Resumen del Portal Business: KPIs y top productos de UN negocio del hub.
 * BUSINESS_VIEWER: siempre su negocio (token). Roles de hub: pasan businessId.
 */
export async function getMyBusinessPortalSummary(req: Request, res: Response): Promise<Response> {
    const ctx = req.hubContext!;
    try {
        const requested = typeof req.query.businessId === "string" ? req.query.businessId : undefined;
        const businessId = resolveScopedBusinessId(ctx, requested);
        if (!businessId) {
            return res.status(400).json({
                status: false,
                statusCode: 400,
                message: ctx.role === "BUSINESS_VIEWER" ? "Acceso sin negocio asignado" : "businessId es requerido",
                data: {},
            });
        }

        // Candado de pertenencia + datos públicos del negocio para el header
        const business = await assertBusinessBelongsToHub(ctx.hubId, businessId);

        const from = typeof req.query.from === "string" ? req.query.from : undefined;
        const to = typeof req.query.to === "string" ? req.query.to : undefined;
        const summaryResp = await getHubOrdersSummary(ctx.hubId, from, to, businessId);
        const summary = summaryResp?.data || { totalOrders: 0, totalSales: 0, byStatus: [], topProducts: [] };

        return res.status(200).json({
            status: true,
            statusCode: 200,
            message: "Resumen del negocio",
            data: {
                business: {
                    _id: business._id,
                    name: business.name,
                    hubSlug: business.hubSlug,
                    image_url: business.image_url,
                    operationalStatus: business.operationalStatus || "active",
                },
                summary,
            },
        });
    } catch (error: any) {
        if (error?.code === "BUSINESS_NOT_IN_HUB") {
            return res.status(403).json({
                status: false,
                statusCode: 403,
                message: "El negocio no pertenece a este hub",
                data: {},
            });
        }
        return upstreamError(res, error, "cargar el resumen del negocio");
    }
}

/**
 * GET /api/hubs/me/dashboard?from=&to=
 * KPIs consolidados: totales del rango + por estado + por negocio (con nombre),
 * más métricas de uso/límites del hub.
 */
export async function getMyHubDashboard(req: Request, res: Response): Promise<Response> {
    const ctx = req.hubContext!;
    try {
        const from = typeof req.query.from === "string" ? req.query.from : undefined;
        const to = typeof req.query.to === "string" ? req.query.to : undefined;

        const [hub, summaryResp, businessesResp] = await Promise.all([
            hubModel.findById(ctx.hubId).select("name slug usageMetrics subscription timezone currency"),
            getHubOrdersSummary(ctx.hubId, from, to).catch((e) => {
                console.error("[dashboard] summary error:", e?.response?.data || e?.message);
                return null;
            }),
            getBusinessesByHubId(ctx.hubId).catch(() => null),
        ]);

        if (!hub) {
            return res.status(404).json({ status: false, statusCode: 404, message: "Hub no encontrado", data: {} });
        }

        const businesses: any[] = businessesResp?.data?.businesses || [];
        const nameById = new Map(businesses.map((b: any) => [String(b._id), b.name]));
        const summary = summaryResp?.data || { totalOrders: 0, totalSales: 0, byStatus: [], byBusiness: [] };
        const byBusiness = (summary.byBusiness || []).map((b: any) => ({
            ...b,
            name: nameById.get(String(b.businessId)) || b.businessId,
        }));

        return res.status(200).json({
            status: true,
            statusCode: 200,
            message: "Dashboard del hub",
            data: {
                hub: {
                    name: hub.name,
                    slug: hub.slug,
                    currency: hub.currency,
                    usageMetrics: hub.usageMetrics,
                    limits: hub.subscription?.limits,
                },
                summary: { ...summary, byBusiness },
                businesses: {
                    total: businesses.length,
                    active: businesses.filter((b: any) => (b.operationalStatus || "active") === "active").length,
                    paused: businesses.filter((b: any) => b.operationalStatus === "paused").length,
                    temporarilyClosed: businesses.filter((b: any) => b.operationalStatus === "temporarily_closed").length,
                },
            },
        });
    } catch (error: any) {
        return upstreamError(res, error, "cargar el dashboard");
    }
}
