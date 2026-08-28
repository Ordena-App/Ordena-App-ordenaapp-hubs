import { Request, Response } from "express";
import hubModel from "../models/hubModel";
import hubPlanModel from "../models/hubPlanModel";
import { applyPlanToHub } from "../utils/applyHubPlan";
import {
    createHubCheckoutSessionExternal,
    createHubPortalSessionExternal,
} from "../services/paymentsBilling.external";
import { INTERNAL_SHARED_SECRET } from "../config/config";

function isValidInternalCall(req: Request): boolean {
    if (!INTERNAL_SHARED_SECRET) return false;
    const header = (req.headers["x-ordena-secret"] || req.headers["X-Ordena-Secret"]) as string | undefined;
    return header === INTERNAL_SHARED_SECRET;
}

function upstreamError(res: Response, error: any, action: string): Response {
    const upstreamStatus = error?.response?.status;
    if (upstreamStatus && upstreamStatus >= 400 && upstreamStatus < 500 && error?.response?.data) {
        return res.status(upstreamStatus).json(error.response.data);
    }
    console.error(`Error en ${action}:`, error?.response?.data || error?.message || error);
    return res.status(502).json({
        status: false,
        statusCode: 502,
        message: `No se pudo ${action} (payments-service respondió ${upstreamStatus ?? "sin conexión"})`,
        data: {},
    });
}

/**
 * PATCH /api/hubs/internal/:hubId/subscription  (interno — lo llama payments
 * desde el webhook de Stripe). Body: { lookupKey, status?, periodStart?,
 * periodEnd?, billingCycle? }. Resuelve el plan por lookupKey en hub_plans y
 * aplica el snapshot vía applyPlanToHub (único camino de escritura).
 */
export async function patchHubSubscriptionInternal(req: Request, res: Response): Promise<Response> {
    try {
        if (!isValidInternalCall(req)) {
            return res.status(403).json({ status: false, statusCode: 403, message: "Llamada interna no autorizada", data: {} });
        }
        const hubId = String(req.params.hubId);
        const { lookupKey, status, periodStart, periodEnd, billingCycle } = req.body || {};
        if (!lookupKey || typeof lookupKey !== "string") {
            return res.status(400).json({ status: false, statusCode: 400, message: "lookupKey es requerido", data: {} });
        }
        const hub = await hubModel.findById(hubId).select("_id");
        if (!hub) {
            return res.status(404).json({ status: false, statusCode: 404, message: "Hub no encontrado", data: {} });
        }

        const plan = await hubPlanModel.findOne({ lookupKeys: lookupKey, is_active: true }).lean();
        await applyPlanToHub({
            hubId,
            lookupKey,
            status: typeof status === "string" ? status : undefined,
            periodStart: periodStart || null,
            periodEnd: periodEnd || null,
            billingCycle: billingCycle === "yearly" ? "yearly" : billingCycle === "monthly" ? "monthly" : undefined,
            plan: plan as any,
        });

        return res.status(200).json({
            status: true,
            statusCode: 200,
            message: "Suscripción del hub actualizada",
            data: { planCode: (plan as any)?.code ?? null, planFound: !!plan },
        });
    } catch (error) {
        console.error("Error en patchHubSubscriptionInternal:", error);
        return res.status(500).json({ status: false, statusCode: 500, message: "Error interno del servidor", data: {} });
    }
}

/**
 * GET /api/hubs/plans  (público) — catálogo para la vitrina de planes.
 * Solo isPublic + is_active; sin lookupKeys (el checkout valida server-side).
 */
export async function getHubPlansPublic(_req: Request, res: Response): Promise<Response> {
    try {
        const docs = await hubPlanModel
            .find({ isPublic: true, is_active: true })
            .select("code name description price currency billingCycle limits lookupKeys")
            .sort({ price: 1 })
            .lean();
        // El frontend no adivina lookup keys por convención: el catálogo dice
        // con cuál se hace checkout (el primero del plan). No es secreto — el
        // checkout re-valida contra hub_plans de todas formas.
        const plans = docs.map((d: any) => {
            const { lookupKeys, ...rest } = d;
            return { ...rest, checkoutLookupKey: Array.isArray(lookupKeys) ? lookupKeys[0] || null : null };
        });
        return res.status(200).json({
            status: true,
            statusCode: 200,
            message: "Planes de hub",
            data: { plans },
        });
    } catch (error) {
        console.error("Error en getHubPlansPublic:", error);
        return res.status(500).json({ status: false, statusCode: 500, message: "Error interno del servidor", data: {} });
    }
}

/**
 * GET /api/hubs/me/billing  (HUB_OWNER / HUB_ADMIN)
 * Plan actual + límites (snapshot) + uso del mes + excedente proyectado.
 * Los números salen de aquí — el frontend no replica precios ni límites.
 */
export async function getMyHubBilling(req: Request, res: Response): Promise<Response> {
    try {
        const ctx = req.hubContext!;
        const hub = await hubModel.findById(ctx.hubId).select("subscription usageMetrics currency").lean();
        if (!hub) {
            return res.status(404).json({ status: false, statusCode: 404, message: "Hub no encontrado", data: {} });
        }
        const sub: any = (hub as any).subscription || {};
        const usage: any = (hub as any).usageMetrics || {};
        const limits: any = sub.limits || {};

        const plan = sub.planRef?.code
            ? await hubPlanModel.findOne({ code: sub.planRef.code }).select("code name price currency billingCycle").lean()
            : null;

        // Excedente proyectado del mes EN CURSO (informativo — la factura real
        // se arma re-contando orders al cierre del período, no con el contador).
        const ordersLimit = limits.ordersPerMonth ?? -1;
        const ordersUsed = usage.ordersCurrentMonth || 0;
        const extraOrders = ordersLimit === -1 ? 0 : Math.max(0, ordersUsed - ordersLimit);
        const businessesIncluded = limits.businessesIncluded ?? -1;
        const businessesCount = usage.businessesCount || 0;
        const extraBusinesses = businessesIncluded === -1 ? 0 : Math.max(0, businessesCount - businessesIncluded);
        const projectedOverage =
            extraOrders * (limits.extraOrderPrice || 0) + extraBusinesses * (limits.extraBusinessPrice || 0);

        return res.status(200).json({
            status: true,
            statusCode: 200,
            message: "Facturación del hub",
            data: {
                subscription: {
                    status: sub.status || "TRIAL",
                    planRef: sub.planRef || null,
                    period: sub.period || null,
                    billingCycle: sub.billingCycle || "monthly",
                    limits,
                },
                plan,
                usage: {
                    businessesCount,
                    ordersCurrentMonth: ordersUsed,
                    ordersPreviousMonth: usage.ordersPreviousMonth || 0,
                    extraOrdersCurrentMonth: usage.extraOrdersCurrentMonth || 0,
                },
                projected: { extraOrders, extraBusinesses, projectedOverage: Math.round(projectedOverage * 100) / 100 },
            },
        });
    } catch (error) {
        console.error("Error en getMyHubBilling:", error);
        return res.status(500).json({ status: false, statusCode: 500, message: "Error interno del servidor", data: {} });
    }
}

/**
 * POST /api/hubs/me/billing/checkout-session  (HUB_OWNER)
 * Body: { lookupKey, trialDays? }. El lookupKey DEBE existir en hub_plans:
 * impide usar este proxy para suscribirse a un plan CORE (o a cualquier price
 * ajeno) con el JWT del hub.
 */
export async function createMyHubCheckoutSession(req: Request, res: Response): Promise<Response> {
    const ctx = req.hubContext!;
    try {
        const lookupKey = String(req.body?.lookupKey || "").trim();
        if (!lookupKey) {
            return res.status(400).json({ status: false, statusCode: 400, message: "lookupKey es requerido", data: {} });
        }
        const plan = await hubPlanModel.findOne({ lookupKeys: lookupKey, is_active: true }).select("code").lean();
        if (!plan) {
            return res.status(400).json({ status: false, statusCode: 400, message: "Ese plan no existe en el catálogo de hubs", data: {} });
        }
        const rawTrial = Number(req.body?.trialDays);
        const trialDays = Number.isFinite(rawTrial) ? Math.min(30, Math.max(0, Math.floor(rawTrial))) : undefined;

        const hub = await hubModel.findById(ctx.hubId).select("slug").lean();
        const resp = await createHubCheckoutSessionExternal({
            hubId: ctx.hubId,
            lookupKey,
            customerEmail: ctx.email,
            hubSlug: (hub as any)?.slug,
            trialDays,
        });
        return res.status(200).json(resp);
    } catch (error: any) {
        return upstreamError(res, error, "crear la sesión de pago");
    }
}

/** POST /api/hubs/me/billing/portal-session  (HUB_OWNER) */
export async function createMyHubPortalSession(req: Request, res: Response): Promise<Response> {
    const ctx = req.hubContext!;
    try {
        const resp = await createHubPortalSessionExternal({ hubId: ctx.hubId });
        return res.status(200).json(resp);
    } catch (error: any) {
        return upstreamError(res, error, "abrir el portal de facturación");
    }
}
