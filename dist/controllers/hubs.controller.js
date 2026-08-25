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
exports.getMyHub = getMyHub;
exports.updateMyHub = updateMyHub;
exports.incrementHubOrderUsage = incrementHubOrderUsage;
const hubModel_1 = __importDefault(require("../models/hubModel"));
const hubCategoryModel_1 = __importDefault(require("../models/hubCategoryModel"));
const config_1 = require("../config/config");
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
                .select("name slug description logo favicon branding contact timezone country currency language domain status");
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
function getMyHub(req, res) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            const ctx = req.hubContext;
            // El Portal Business solo necesita identidad y branding del hub: nunca
            // su suscripción, límites ni métricas de uso (información del operador).
            const projection = ctx.role === "BUSINESS_VIEWER"
                ? "name slug logo favicon branding contact timezone country currency language"
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
    "timezone",
    "language",
    "businessVisibility",
];
/** PUT /api/hubs/me  (HUB_OWNER/HUB_ADMIN) */
function updateMyHub(req, res) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            const ctx = req.hubContext;
            const patch = {};
            for (const field of UPDATABLE_FIELDS) {
                if (req.body && req.body[field] !== undefined)
                    patch[field] = req.body[field];
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
// Interno server-to-server (orders-service): contador de pedidos del hub.
// Guardado por INTERNAL_SHARED_SECRET (header x-ordena-secret; compat: si la
// env no está configurada, se acepta sin header — mismo patrón del bot).
// ────────────────────────────────────────────────────────────────────────────
function isValidInternalCall(req) {
    if (!config_1.INTERNAL_SHARED_SECRET)
        return true;
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
            // Rotación mensual (UTC) — idéntico patrón al usageMetrics de business.
            const now = new Date();
            const last = hub.usageMetrics.lastRotatedAt ? new Date(hub.usageMetrics.lastRotatedAt) : null;
            const sameMonth = !!last &&
                last.getUTCFullYear() === now.getUTCFullYear() &&
                last.getUTCMonth() === now.getUTCMonth();
            let rotated = false;
            if (!sameMonth) {
                yield hubModel_1.default.updateOne({ _id: hubId }, {
                    $set: {
                        "usageMetrics.ordersPreviousMonth": hub.usageMetrics.ordersCurrentMonth || 0,
                        "usageMetrics.ordersCurrentMonth": 0,
                        "usageMetrics.extraOrdersCurrentMonth": 0,
                        "usageMetrics.lastRotatedAt": now,
                    },
                });
                rotated = true;
            }
            const limit = (_c = (_b = (_a = hub.subscription) === null || _a === void 0 ? void 0 : _a.limits) === null || _b === void 0 ? void 0 : _b.ordersPerMonth) !== null && _c !== void 0 ? _c : -1;
            const updated = yield hubModel_1.default.findByIdAndUpdate(hubId, { $inc: { "usageMetrics.ordersCurrentMonth": 1 }, $set: { updated_at: now } }, { new: true });
            const current = (_d = updated === null || updated === void 0 ? void 0 : updated.usageMetrics.ordersCurrentMonth) !== null && _d !== void 0 ? _d : 0;
            const isExtra = limit !== -1 && current > limit;
            if (isExtra) {
                yield hubModel_1.default.updateOne({ _id: hubId }, { $inc: { "usageMetrics.extraOrdersCurrentMonth": 1 } });
            }
            return res.status(200).json({
                status: true,
                statusCode: 200,
                message: "Uso incrementado",
                data: { ordersCurrentMonth: current, isExtra, rotated },
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
