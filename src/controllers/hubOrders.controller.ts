import { Request, Response } from "express";
import hubModel from "../models/hubModel";
import { getHubOrders, getHubOrdersSummary, updateHubOrderStatus, notifyDeliveryPersonExternal } from "../services/ordersService.external";
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
 * Matriz de privacidad del hub aplicada a los pedidos que ve un negocio.
 *
 * El operador decide qué datos del cliente final comparte (hub.businessVisibility).
 * El filtrado es SERVER-SIDE a propósito: hacerlo en el cliente sería cosmético
 * — el payload viajaría igual y quedaría en su localStorage.
 *
 * `customer_email` no está en la matriz de tres campos pero es un canal de
 * contacto directo, así que sigue la misma regla que el teléfono.
 */
function stripOrderPII(
    order: Record<string, unknown>,
    visibility: { customerName: boolean; customerPhone: boolean; customerAddress: boolean }
): Record<string, unknown> {
    const clean = { ...order };
    if (!visibility.customerName) clean.customer_name = null;
    if (!visibility.customerPhone) {
        clean.customer_number = null;
        clean.customer_email = null;
    }
    if (!visibility.customerAddress) {
        clean.delivery_address = null;
        clean.delivery_city = null;
        clean.delivery_department = null;
        clean.delivery_reference = null;
    }
    return clean;
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

        // El Portal Business solo recibe los datos del cliente que el hub decide
        // compartir. Los roles del hub ven todo (son los dueños de la operación).
        if (ctx.role === "BUSINESS_VIEWER") {
            const hub = await hubModel.findById(ctx.hubId).select("businessVisibility");
            const visibility = {
                customerName: hub?.businessVisibility?.customerName !== false,
                customerPhone: hub?.businessVisibility?.customerPhone === true,
                customerAddress: hub?.businessVisibility?.customerAddress === true,
            };
            const orders = Array.isArray(resp?.data?.orders) ? resp.data.orders : [];
            return res.status(200).json({
                ...resp,
                data: { ...resp.data, orders: orders.map((o: any) => stripOrderPII(o, visibility)) },
            });
        }

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


/**
 * POST /api/hubs/me/orders/:orderId/notify-delivery
 * El operador avisa a SU repartidor. Un BUSINESS_VIEWER no puede: el delivery
 * del hub lo coordina el operador, no cada negocio.
 */
export async function notifyDeliveryForMyHubOrder(req: Request, res: Response): Promise<Response> {
    const ctx = req.hubContext!;
    try {
        const orderId = String(req.params.orderId);
        const { businessId } = req.body || {};
        if (!businessId) {
            return res.status(400).json({
                status: false,
                statusCode: 400,
                message: "businessId es requerido",
                data: {},
            });
        }
        // El pedido debe ser de un negocio de ESTE hub.
        await assertBusinessBelongsToHub(ctx.hubId, String(businessId));
        const resp = await notifyDeliveryPersonExternal(String(businessId), orderId);
        return res.status(200).json(resp);
    } catch (error: any) {
        const st = error?.response?.status;
        if (st && st >= 400 && st < 500 && error?.response?.data) {
            return res.status(st).json(error.response.data);
        }
        return upstreamError(res, error, "avisar al repartidor");
    }
}
