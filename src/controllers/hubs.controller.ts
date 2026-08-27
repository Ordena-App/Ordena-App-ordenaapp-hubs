import { Request, Response } from "express";
import mongoose from "mongoose";
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
            .select("name slug description logo favicon branding contact.whatsapp contact.instagram contact.facebook contact.tiktok contact.website timezone country currency language domain status");
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
/**
 * GET /api/hubs/resolve-store?storeLink=pizzeria--ab12cd
 * PÚBLICO — lo consume el middleware del frontend en hosts core (ordena.app):
 * si un visitante abre la URL namespaceada de un negocio de hub SIN contexto
 * de hub (enlace compartido, resultado de Google), el middleware redirige 301
 * al subdominio del hub para que el checkout use los métodos del HUB y el SEO
 * no duplique contenido. Lee la colección businesses de la shared DB (mismo
 * patrón que payments/isHubKey).
 */
export async function resolveHubStore(req: Request, res: Response): Promise<Response> {
    try {
        const storeLink = String(req.query.storeLink || "").trim().toLowerCase();
        // Solo aplica a store_links namespaceados de hub: {slug}--{6 hex}
        if (!/^[a-z0-9][a-z0-9-]*--[0-9a-f]{6}$/.test(storeLink)) {
            return res.status(400).json({
                status: false,
                statusCode: 400,
                message: "storeLink inválido",
                data: {},
            });
        }

        const db = mongoose.connection.db;
        const biz = db
            ? await db.collection("businesses").findOne(
                  { store_link: storeLink, context: "HUB_MANAGED" },
                  { projection: { hubId: 1, hubSlug: 1 } }
              )
            : null;
        if (!biz?.hubId) {
            return res.status(404).json({
                status: false,
                statusCode: 404,
                message: "No es un negocio de hub",
                data: {},
            });
        }

        const hub = await hubModel.findOne({ _id: biz.hubId, status: "ACTIVE" }).select("slug");
        if (!hub?.slug) {
            return res.status(404).json({
                status: false,
                statusCode: 404,
                message: "Hub no disponible",
                data: {},
            });
        }

        return res.status(200).json({
            status: true,
            statusCode: 200,
            message: "Negocio de hub resuelto",
            data: { hubSlug: hub.slug, businessSlug: biz.hubSlug || null },
        });
    } catch (error) {
        console.error("Error en resolveHubStore:", error);
        return res.status(500).json({
            status: false,
            statusCode: 500,
            message: "Error interno del servidor",
            data: {},
        });
    }
}

export async function getMyHub(req: Request, res: Response): Promise<Response> {
    try {
        const ctx = req.hubContext!;
        // El Portal Business solo necesita identidad y branding del hub: nunca
        // su suscripción, límites ni métricas de uso (información del operador).
        const projection =
            ctx.role === "BUSINESS_VIEWER"
                ? "name slug logo favicon branding timezone country currency language"
                : undefined;
        const query = hubModel.findById(ctx.hubId);
        const hub = projection ? await query.select(projection) : await query;
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
        // Los objetos anidados se aplican por DOT-PATH: mandar `contact` con dos
        // claves ya no borra las demás (antes el $set del objeto entero se
        // llevaba por delante deliveryWhatsapp, email, tiktok…).
        const NESTED = new Set(["branding", "contact", "businessVisibility"]);
        const patch: Record<string, unknown> = {};
        for (const field of UPDATABLE_FIELDS) {
            const value = req.body ? req.body[field] : undefined;
            if (value === undefined) continue;
            if (NESTED.has(field) && value && typeof value === "object" && !Array.isArray(value)) {
                for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
                    if (inner !== undefined) patch[`${field}.${key}`] = inner;
                }
            } else {
                patch[field] = value;
            }
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
// Endpoints internos server-to-server (orders-service).
// FAIL-CLOSED: sin el secreto configurado se rechaza todo — igual que los
// guards de business/orders/products. Estos endpoints exponen los teléfonos
// del operador y del repartidor, y mutan contadores de facturación.
// ────────────────────────────────────────────────────────────────────────────

function isValidInternalCall(req: Request): boolean {
    if (!INTERNAL_SHARED_SECRET) return false;
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


/**
 * GET /api/hubs/internal/:hubId/notification-config  (interno, orders)
 * Datos que orders necesita para las plantillas de WhatsApp del hub:
 * a quién avisar y qué información puede ver el negocio.
 */
export async function getHubNotificationConfig(req: Request, res: Response): Promise<Response> {
    try {
        if (!isValidInternalCall(req)) {
            return res.status(403).json({
                status: false,
                statusCode: 403,
                message: "Llamada interna no autorizada",
                data: {},
            });
        }
        const hub = await hubModel
            .findById(String(req.params.hubId))
            .select("name contact businessVisibility");
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
            message: "Configuración de notificaciones",
            data: {
                hubName: hub.name,
                hubWhatsapp: hub.contact?.whatsapp || null,
                deliveryWhatsapp: hub.contact?.deliveryWhatsapp || null,
                businessVisibility: hub.businessVisibility,
            },
        });
    } catch (error) {
        console.error("Error leyendo configuración de notificaciones:", error);
        return res.status(500).json({
            status: false,
            statusCode: 500,
            message: "Error interno del servidor",
            data: {},
        });
    }
}
