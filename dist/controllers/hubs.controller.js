"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveHubBySlug = resolveHubBySlug;
exports.resolveHubStore = resolveHubStore;
exports.getMyHub = getMyHub;
exports.updateMyHub = updateMyHub;
exports.incrementHubOrderUsage = incrementHubOrderUsage;
exports.getHubNotificationConfig = getHubNotificationConfig;
const mongoose_1 = __importDefault(require("mongoose"));
const hubModel_1 = __importDefault(require("../models/hubModel"));
const hubCategoryModel_1 = __importDefault(require("../models/hubCategoryModel"));
const config_1 = require("../config/config");
const businessService_external_1 = require("../services/businessService.external");
/**
 * GET /api/hubs/resolve?slug=oe-ya
 * PÚBLICO — lo consumen el middleware del frontend y el storefront del hub
 * para resolver {slug}.ordena.app. Devuelve solo información pública.
 */
function resolveHubBySlug(req, res) {
    return __awaiter(this, void 0, void 0, function* () {
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
            const hub = yield hubModel_1.default
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
            const categories = yield hubCategoryModel_1.default
                .find({ hub_id: hub._id, isActive: true })
                .select("name slug image_url sort_order")
                .sort({ sort_order: 1, name: 1 });
            return res.status(200).json({
                status: true,
                statusCode: 200,
                message: "Hub resuelto",
                data: { hub, categories },
            });
        }
        catch (error) {
            console.error("Error resolviendo hub:", error);
            return res.status(500).json({
                status: false,
                statusCode: 500,
                message: "Error interno del servidor",
                data: { error: error instanceof Error ? error.message : error },
            });
        }
    });
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
function resolveHubStore(req, res) {
    return __awaiter(this, void 0, void 0, function* () {
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
            const db = mongoose_1.default.connection.db;
            const biz = db
                ? yield db.collection("businesses").findOne({ store_link: storeLink, context: "HUB_MANAGED" }, { projection: { hubId: 1, hubSlug: 1 } })
                : null;
            if (!(biz === null || biz === void 0 ? void 0 : biz.hubId)) {
                return res.status(404).json({
                    status: false,
                    statusCode: 404,
                    message: "No es un negocio de hub",
                    data: {},
                });
            }
            const hub = yield hubModel_1.default.findOne({ _id: biz.hubId, status: "ACTIVE" }).select("slug");
            if (!(hub === null || hub === void 0 ? void 0 : hub.slug)) {
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
        }
        catch (error) {
            console.error("Error en resolveHubStore:", error);
            return res.status(500).json({
                status: false,
                statusCode: 500,
                message: "Error interno del servidor",
                data: {},
            });
        }
    });
}
function getMyHub(req, res) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            const ctx = req.hubContext;
            // El Portal Business solo necesita identidad y branding del hub: nunca
            // su suscripción, límites ni métricas de uso (información del operador).
            const projection = ctx.role === "BUSINESS_VIEWER"
                ? "name slug logo favicon branding timezone country currency language"
                : undefined;
            const query = hubModel_1.default.findById(ctx.hubId);
            const hub = projection ? yield query.select(projection) : yield query;
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
        }
        catch (error) {
            console.error("Error obteniendo hub:", error);
            return res.status(500).json({
                status: false,
                statusCode: 500,
                message: "Error interno del servidor",
                data: { error: error instanceof Error ? error.message : error },
            });
        }
    });
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
    "settlementConfig",
    "commissionOverrides",
    "timezone",
    "language",
    "businessVisibility",
    "deliveryDefaults",
    "fulfillment",
];
/** PUT /api/hubs/me  (HUB_OWNER/HUB_ADMIN) */
function updateMyHub(req, res) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l;
        try {
            const ctx = req.hubContext;
            // Los objetos anidados se aplican por DOT-PATH: mandar `contact` con dos
            // claves ya no borra las demás (antes el $set del objeto entero se
            // llevaba por delante deliveryWhatsapp, email, tiktok…).
            const NESTED = new Set(["branding", "contact", "businessVisibility", "settlementConfig", "deliveryDefaults", "fulfillment"]);
            const patch = {};
            for (const field of UPDATABLE_FIELDS) {
                const value = req.body ? req.body[field] : undefined;
                if (value === undefined)
                    continue;
                if (NESTED.has(field) && value && typeof value === "object" && !Array.isArray(value)) {
                    for (const [key, inner] of Object.entries(value)) {
                        if (inner === undefined)
                            continue;
                        // deliveryDefaults: solo sus 3 claves y solo string|null —
                        // un typo o un objeto aquí sería un 200 mentiroso (mongoose
                        // strict lo descarta) o CastError→500, y dispararía la
                        // propagación sin haber cambiado nada.
                        if (field === "deliveryDefaults") {
                            if (!["state", "stateIso", "city"].includes(key))
                                continue;
                            if (inner !== null && typeof inner !== "string")
                                continue;
                        }
                        // fulfillment: solo sus 3 claves; booleanos + fee número >= 0.
                        if (field === "fulfillment") {
                            if (!["deliveryEnabled", "pickupEnabled", "deliveryFee"].includes(key))
                                continue;
                            if (key === "deliveryFee") {
                                if (typeof inner !== "number" || !Number.isFinite(inner) || inner < 0)
                                    continue;
                            }
                            else if (typeof inner !== "boolean") {
                                continue;
                            }
                        }
                        patch[`${field}.${key}`] = inner;
                    }
                    // Regla "mínimo un método": ambos apagados en el mismo body no
                    // es un estado operable — se restaura la recogida (mismo
                    // fail-open que sanitizeHubFulfillment en business-service,
                    // para que hub y negocios nunca diverjan).
                    if (field === "fulfillment" &&
                        patch["fulfillment.deliveryEnabled"] === false &&
                        patch["fulfillment.pickupEnabled"] === false) {
                        patch["fulfillment.pickupEnabled"] = true;
                    }
                }
                else if (field === "deliveryDefaults" || field === "fulfillment") {
                    // Solo se acepta como objeto: un `deliveryDefaults: null` crudo
                    // actualizaría el hub sin disparar la propagación (el hook
                    // detecta claves con punto) y dejaría los negocios desfasados.
                    continue;
                }
                else {
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
            const hub = yield hubModel_1.default.findByIdAndUpdate(ctx.hubId, { $set: patch }, { new: true });
            // Herencia de branding: si cambió el color primario del hub, el tema del
            // storefront de TODOS sus negocios se re-sincroniza (los negocios de hub
            // no editan su tienda; el branding del hub es su fuente de verdad).
            // Best-effort: si business-service no responde, el update del hub ya quedó.
            const brandingTouched = patch["branding.primaryColor"] !== undefined ||
                patch["branding.primaryForeground"] !== undefined;
            const primaryColor = (_a = hub === null || hub === void 0 ? void 0 : hub.branding) === null || _a === void 0 ? void 0 : _a.primaryColor;
            if (brandingTouched && hub && primaryColor) {
                try {
                    yield (0, businessService_external_1.propagateHubStorefrontThemeExternal)(String(ctx.hubId), {
                        primaryColor: String(primaryColor),
                        primaryForeground: ((_b = hub.branding) === null || _b === void 0 ? void 0 : _b.primaryForeground)
                            ? String(hub.branding.primaryForeground)
                            : undefined,
                    });
                }
                catch (propagateError) {
                    console.error("No se pudo propagar el branding a los negocios del hub:", propagateError instanceof Error ? propagateError.message : propagateError);
                }
            }
            // Ubicación de entrega por defecto: si cambió, se re-sincroniza el
            // prefill del checkout de TODOS sus negocios (mismo patrón best-effort
            // que el branding: el update del hub ya quedó aunque esto falle).
            const deliveryDefaultsTouched = Object.keys(patch).some((k) => k.startsWith("deliveryDefaults."));
            if (deliveryDefaultsTouched && hub) {
                try {
                    yield (0, businessService_external_1.propagateHubDeliveryDefaultsExternal)(String(ctx.hubId), {
                        state: (_d = (_c = hub.deliveryDefaults) === null || _c === void 0 ? void 0 : _c.state) !== null && _d !== void 0 ? _d : null,
                        stateIso: (_f = (_e = hub.deliveryDefaults) === null || _e === void 0 ? void 0 : _e.stateIso) !== null && _f !== void 0 ? _f : null,
                        city: (_h = (_g = hub.deliveryDefaults) === null || _g === void 0 ? void 0 : _g.city) !== null && _h !== void 0 ? _h : null,
                    });
                }
                catch (propagateError) {
                    console.error("No se pudo propagar la ubicación de entrega a los negocios del hub:", propagateError instanceof Error ? propagateError.message : propagateError);
                }
            }
            // Métodos de entrega (fulfillment): mismo patrón best-effort.
            const fulfillmentTouched = Object.keys(patch).some((k) => k.startsWith("fulfillment."));
            if (fulfillmentTouched && hub) {
                try {
                    yield (0, businessService_external_1.propagateHubFulfillmentExternal)(String(ctx.hubId), {
                        deliveryEnabled: ((_j = hub.fulfillment) === null || _j === void 0 ? void 0 : _j.deliveryEnabled) !== false,
                        pickupEnabled: ((_k = hub.fulfillment) === null || _k === void 0 ? void 0 : _k.pickupEnabled) !== false,
                        deliveryFee: typeof ((_l = hub.fulfillment) === null || _l === void 0 ? void 0 : _l.deliveryFee) === "number" && hub.fulfillment.deliveryFee >= 0
                            ? hub.fulfillment.deliveryFee
                            : 0,
                    });
                }
                catch (propagateError) {
                    console.error("No se pudieron propagar los métodos de entrega a los negocios del hub:", propagateError instanceof Error ? propagateError.message : propagateError);
                }
            }
            return res.status(200).json({
                status: true,
                statusCode: 200,
                message: "Hub actualizado",
                data: { hub },
            });
        }
        catch (error) {
            console.error("Error actualizando hub:", error);
            return res.status(500).json({
                status: false,
                statusCode: 500,
                message: "Error interno del servidor",
                data: { error: error instanceof Error ? error.message : error },
            });
        }
    });
}
// ────────────────────────────────────────────────────────────────────────────
// Endpoints internos server-to-server (orders-service).
// FAIL-CLOSED: sin el secreto configurado se rechaza todo — igual que los
// guards de business/orders/products. Estos endpoints exponen los teléfonos
// del operador y del repartidor, y mutan contadores de facturación.
// ────────────────────────────────────────────────────────────────────────────
function isValidInternalCall(req) {
    if (!config_1.INTERNAL_SHARED_SECRET)
        return false;
    const header = (req.headers["x-ordena-secret"] || req.headers["X-Ordena-Secret"]);
    return header === config_1.INTERNAL_SHARED_SECRET;
}
/**
 * PATCH /api/hubs/internal/:hubId/usage/increment-order
 * Lo llama orders-service cuando se crea un pedido con hub_id (best-effort).
 * Rota las métricas si cambió el mes (UTC, idempotente) y luego incrementa.
 * Devuelve isExtra=true cuando el pedido supera ordersPerMonth del plan.
 */
function incrementHubOrderUsage(req, res) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b, _c, _d;
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
            const hub = yield hubModel_1.default.findById(hubId);
            if (!hub) {
                return res.status(404).json({
                    status: false,
                    statusCode: 404,
                    message: "Hub no encontrado",
                    data: {},
                });
            }
            // Rotación mensual (UTC) — ATÓMICA (F3 v2, base de facturación).
            // Antes era leer-decidir-escribir: dos pedidos concurrentes en el cambio
            // de mes podían rotar ambos y el segundo pisaba el incremento del
            // primero. Ahora un solo updateOne con pipeline, condicionado a que
            // lastRotatedAt sea anterior al inicio del mes: solo un llamador gana.
            const now = new Date();
            const monthStartUtc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
            const rotRes = yield hubModel_1.default.updateOne({
                _id: hubId,
                $or: [
                    { "usageMetrics.lastRotatedAt": { $lt: monthStartUtc } },
                    { "usageMetrics.lastRotatedAt": null },
                ],
            }, [
                {
                    $set: {
                        "usageMetrics.ordersPreviousMonth": { $ifNull: ["$usageMetrics.ordersCurrentMonth", 0] },
                        "usageMetrics.ordersCurrentMonth": 0,
                        "usageMetrics.extraOrdersCurrentMonth": 0,
                        "usageMetrics.lastRotatedAt": "$$NOW",
                    },
                },
            ]);
            const rotated = rotRes.modifiedCount > 0;
            const limit = (_c = (_b = (_a = hub.subscription) === null || _a === void 0 ? void 0 : _a.limits) === null || _b === void 0 ? void 0 : _b.ordersPerMonth) !== null && _c !== void 0 ? _c : -1;
            const updated = yield hubModel_1.default.findByIdAndUpdate(hubId, { $inc: { "usageMetrics.ordersCurrentMonth": 1 }, $set: { updated_at: now } }, { new: true });
            const current = (_d = updated === null || updated === void 0 ? void 0 : updated.usageMetrics.ordersCurrentMonth) !== null && _d !== void 0 ? _d : 0;
            const isExtra = limit !== -1 && current > limit;
            if (isExtra) {
                yield hubModel_1.default.updateOne({ _id: hubId }, { $inc: { "usageMetrics.extraOrdersCurrentMonth": 1 } });
            }
            // ── Aviso del 80% (F3 v2): claim atómico, máx. 1 por mes ──
            // Se dispara al CRUZAR ceil(80% del límite). orders manda el WhatsApp
            // (aquí no hay cliente del bot); esto solo decide si toca avisar.
            let nudge80 = false;
            if (limit !== -1 && limit > 0) {
                const threshold = Math.ceil(limit * 0.8);
                if (current >= threshold && current < limit) {
                    const monthKey = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
                    const claimed = yield hubModel_1.default.findOneAndUpdate({ _id: hubId, "usageMetrics.nudge80MonthKey": { $ne: monthKey } }, { $set: { "usageMetrics.nudge80MonthKey": monthKey } }, { new: false });
                    nudge80 = !!claimed;
                }
            }
            return res.status(200).json({
                status: true,
                statusCode: 200,
                message: "Uso incrementado",
                data: { ordersCurrentMonth: current, ordersLimit: limit, isExtra, rotated, nudge80 },
            });
        }
        catch (error) {
            console.error("Error incrementando uso del hub:", error);
            return res.status(500).json({
                status: false,
                statusCode: 500,
                message: "Error interno del servidor",
                data: { error: error instanceof Error ? error.message : error },
            });
        }
    });
}
/**
 * GET /api/hubs/internal/:hubId/notification-config  (interno, orders)
 * Datos que orders necesita para las plantillas de WhatsApp del hub:
 * a quién avisar y qué información puede ver el negocio.
 */
function getHubNotificationConfig(req, res) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b;
        try {
            if (!isValidInternalCall(req)) {
                return res.status(403).json({
                    status: false,
                    statusCode: 403,
                    message: "Llamada interna no autorizada",
                    data: {},
                });
            }
            const hub = yield hubModel_1.default
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
                    hubWhatsapp: ((_a = hub.contact) === null || _a === void 0 ? void 0 : _a.whatsapp) || null,
                    deliveryWhatsapp: ((_b = hub.contact) === null || _b === void 0 ? void 0 : _b.deliveryWhatsapp) || null,
                    businessVisibility: hub.businessVisibility,
                },
            });
        }
        catch (error) {
            console.error("Error leyendo configuración de notificaciones:", error);
            return res.status(500).json({
                status: false,
                statusCode: 500,
                message: "Error interno del servidor",
                data: {},
            });
        }
    });
}
