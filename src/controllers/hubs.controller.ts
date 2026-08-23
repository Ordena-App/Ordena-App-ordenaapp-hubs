import { Request, Response } from "express";
import hubModel from "../models/hubModel";
import hubCategoryModel from "../models/hubCategoryModel";
import { INTERNAL_SHARED_SECRET } from "../config/config";

/**
 * GET /api/hubs/resolve?slug=oe-ya
 * PÚBLICO — lo consumen el middleware del frontend y el storefront del hub
 * para resolver {slug}.ordena.app. Devuelve solo información pública.
 */
export async function resolveHubBySlug(req: Request, res: Response): Promise<Response> {
    try {
        const slug = String(req.query.slug || "").trim().toLowerCase();
        if (!slug) {
            return res.status(400).json({
                status: false,
                statusCode: 400,
                message: "slug es requerido",
                data: {},
            });
        }

        const hub = await hubModel
            .findOne({ slug, status: "ACTIVE" })
            .select("name slug description logo favicon branding contact timezone country currency language domain status");
        if (!hub) {
            return res.status(404).json({
                status: false,
                statusCode: 404,
                message: "Hub no encontrado",
                data: {},
            });
        }

        const categories = await hubCategoryModel
            .find({ hub_id: hub._id, isActive: true })
            .select("name slug image_url sort_order")
            .sort({ sort_order: 1, name: 1 });

        return res.status(200).json({
            status: true,
            statusCode: 200,
            message: "Hub resuelto",
            data: { hub, categories },
        });
    } catch (error) {
        console.error("Error resolviendo hub:", error);
        return res.status(500).json({
            status: false,
            statusCode: 500,
            message: "Error interno del servidor",
            data: { error: error instanceof Error ? error.message : error },
        });
    }
}

/** GET /api/hubs/me — hub del usuario autenticado. */
export async function getMyHub(req: Request, res: Response): Promise<Response> {
    try {
        const ctx = req.hubContext!;
        const hub = await hubModel.findById(ctx.hubId);
        if (!hub) {
            return res.status(404).json({
                status: false,
                statusCode: 404,
                message: "Hub no encontrado",
                data: {},
            });
        }
        return res.status(200).json({
            status: true,
            statusCode: 200,
            message: "Hub",
            data: { hub },
        });
    } catch (error) {
        console.error("Error obteniendo hub:", error);
        return res.status(500).json({
            status: false,
            statusCode: 500,
            message: "Error interno del servidor",
            data: { error: error instanceof Error ? error.message : error },
        });
    }
}

// Campos editables por el hub. El slug NO se edita aquí (cambiarlo rompe la
// URL pública; será un flujo aparte con validaciones cuando se necesite).
const UPDATABLE_FIELDS = [
    "name",
    "description",
    "logo",
    "favicon",
    "branding",
    "contact",
    "timezone",
    "language",
    "businessVisibility",
] as const;

/** PUT /api/hubs/me  (HUB_OWNER/HUB_ADMIN) */
export async function updateMyHub(req: Request, res: Response): Promise<Response> {
    try {
        const ctx = req.hubContext!;
        const patch: Record<string, unknown> = {};
        for (const field of UPDATABLE_FIELDS) {
            if (req.body && req.body[field] !== undefined) patch[field] = req.body[field];
        }
        if (Object.keys(patch).length === 0) {
            return res.status(400).json({
                status: false,
                statusCode: 400,
                message: "Nada que actualizar",
                data: {},
            });
        }
        patch["updated_at"] = new Date();

        const hub = await hubModel.findByIdAndUpdate(ctx.hubId, { $set: patch }, { new: true });
        return res.status(200).json({
            status: true,
            statusCode: 200,
            message: "Hub actualizado",
            data: { hub },
        });
    } catch (error) {
        console.error("Error actualizando hub:", error);
        return res.status(500).json({
            status: false,
            statusCode: 500,
            message: "Error interno del servidor",
            data: { error: error instanceof Error ? error.message : error },
        });
    }
}

// ────────────────────────────────────────────────────────────────────────────
// Interno server-to-server (orders-service): contador de pedidos del hub.
// Guardado por INTERNAL_SHARED_SECRET (header x-ordena-secret; compat: si la
// env no está configurada, se acepta sin header — mismo patrón del bot).
// ────────────────────────────────────────────────────────────────────────────

function isValidInternalCall(req: Request): boolean {
    if (!INTERNAL_SHARED_SECRET) return true;
    const header = (req.headers["x-ordena-secret"] || req.headers["X-Ordena-Secret"]) as string | undefined;
    return header === INTERNAL_SHARED_SECRET;
}

/**
 * PATCH /api/hubs/internal/:hubId/usage/increment-order
 * Lo llama orders-service cuando se crea un pedido con hub_id (best-effort).
 * Rota las métricas si cambió el mes (UTC, idempotente) y luego incrementa.
 * Devuelve isExtra=true cuando el pedido supera ordersPerMonth del plan.
 */
export async function incrementHubOrderUsage(req: Request, res: Response): Promise<Response> {
    try {
        if (!isValidInternalCall(req)) {
            return res.status(403).json({
                status: false,
                statusCode: 403,
                message: "Llamada interna no autorizada",
                data: {},
            });
        }
        const hubId = String(req.params.hubId);
        const hub = await hubModel.findById(hubId);
        if (!hub) {
            return res.status(404).json({
                status: false,
                statusCode: 404,
                message: "Hub no encontrado",
                data: {},
            });
        }

        // Rotación mensual (UTC) — idéntico patrón al usageMetrics de business.
        const now = new Date();
        const last = hub.usageMetrics.lastRotatedAt ? new Date(hub.usageMetrics.lastRotatedAt) : null;
        const sameMonth =
            !!last &&
            last.getUTCFullYear() === now.getUTCFullYear() &&
            last.getUTCMonth() === now.getUTCMonth();
        let rotated = false;
        if (!sameMonth) {
            await hubModel.updateOne(
                { _id: hubId },
                {
                    $set: {
                        "usageMetrics.ordersPreviousMonth": hub.usageMetrics.ordersCurrentMonth || 0,
                        "usageMetrics.ordersCurrentMonth": 0,
                        "usageMetrics.extraOrdersCurrentMonth": 0,
                        "usageMetrics.lastRotatedAt": now,
                    },
                }
            );
            rotated = true;
        }

        const limit = hub.subscription?.limits?.ordersPerMonth ?? -1;
        const updated = await hubModel.findByIdAndUpdate(
            hubId,
            { $inc: { "usageMetrics.ordersCurrentMonth": 1 }, $set: { updated_at: now } },
            { new: true }
        );
        const current = updated?.usageMetrics.ordersCurrentMonth ?? 0;
        const isExtra = limit !== -1 && current > limit;
        if (isExtra) {
            await hubModel.updateOne(
                { _id: hubId },
                { $inc: { "usageMetrics.extraOrdersCurrentMonth": 1 } }
            );
        }

        return res.status(200).json({
            status: true,
            statusCode: 200,
            message: "Uso incrementado",
            data: { ordersCurrentMonth: current, isExtra, rotated },
        });
    } catch (error) {
        console.error("Error incrementando uso del hub:", error);
        return res.status(500).json({
            status: false,
            statusCode: 500,
            message: "Error interno del servidor",
            data: { error: error instanceof Error ? error.message : error },
        });
    }
}
