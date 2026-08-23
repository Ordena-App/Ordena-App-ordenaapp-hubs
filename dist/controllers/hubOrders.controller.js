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
exports.getMyHubOrders = getMyHubOrders;
exports.updateMyHubOrderStatus = updateMyHubOrderStatus;
exports.getMyBusinessPortalSummary = getMyBusinessPortalSummary;
exports.getMyHubDashboard = getMyHubDashboard;
const hubModel_1 = __importDefault(require("../models/hubModel"));
const ordersService_external_1 = require("../services/ordersService.external");
const businessService_external_1 = require("../services/businessService.external");
const auth_1 = require("../utils/auth");
function upstreamError(res, error, action) {
    var _a, _b, _c, _d;
    const upstreamStatus = (_a = error === null || error === void 0 ? void 0 : error.response) === null || _a === void 0 ? void 0 : _a.status;
    if (upstreamStatus === 404 && ((_c = (_b = error === null || error === void 0 ? void 0 : error.response) === null || _b === void 0 ? void 0 : _b.data) === null || _c === void 0 ? void 0 : _c.message)) {
        return res.status(404).json(error.response.data);
    }
    console.error(`Error en ${action}:`, ((_d = error === null || error === void 0 ? void 0 : error.response) === null || _d === void 0 ? void 0 : _d.data) || (error === null || error === void 0 ? void 0 : error.message) || error);
    return res.status(502).json({
        status: false,
        statusCode: 502,
        message: `No se pudo ${action} (orders-service respondió ${upstreamStatus !== null && upstreamStatus !== void 0 ? upstreamStatus : "sin conexión"})`,
        data: {},
    });
}
/**
 * GET /api/hubs/me/orders — pedidos consolidados del hub.
 * Filtros: businessId, status, from, to, page, limit.
 * BUSINESS_VIEWER queda SIEMPRE limitado a su negocio (scope del token).
 */
function getMyHubOrders(req, res) {
    return __awaiter(this, void 0, void 0, function* () {
        const ctx = req.hubContext;
        try {
            const requested = typeof req.query.businessId === "string" ? req.query.businessId : undefined;
            const scoped = (0, auth_1.resolveScopedBusinessId)(ctx, requested);
            if (ctx.role === "BUSINESS_VIEWER" && !scoped) {
                return res.status(403).json({
                    status: false,
                    statusCode: 403,
                    message: "No tienes acceso a ese negocio",
                    data: {},
                });
            }
            const resp = yield (0, ordersService_external_1.getHubOrders)(ctx.hubId, {
                page: Number(req.query.page) || 1,
                limit: Number(req.query.limit) || 20,
                businessId: scoped || undefined,
                status: typeof req.query.status === "string" ? req.query.status : undefined,
                from: typeof req.query.from === "string" ? req.query.from : undefined,
                to: typeof req.query.to === "string" ? req.query.to : undefined,
            });
            return res.status(200).json(resp);
        }
        catch (error) {
            return upstreamError(res, error, "listar los pedidos");
        }
    });
}
/**
 * PATCH /api/hubs/me/orders/:orderId/status
 * Body: { order_status?, payment_status? }
 * Roles de hub cambian cualquier pedido del hub; BUSINESS_VIEWER solo los de
 * SU negocio (el filtro viaja a orders y se re-valida allá).
 */
function updateMyHubOrderStatus(req, res) {
    return __awaiter(this, void 0, void 0, function* () {
        const ctx = req.hubContext;
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
            const resp = yield (0, ordersService_external_1.updateHubOrderStatus)(ctx.hubId, orderId, {
                order_status,
                payment_status,
                businessId: scopedBusinessId,
            });
            return res.status(200).json(resp);
        }
        catch (error) {
            return upstreamError(res, error, "actualizar el pedido");
        }
    });
}
/**
 * GET /api/hubs/me/portal/summary?from=&to=[&businessId=]
 * Resumen del Portal Business: KPIs y top productos de UN negocio del hub.
 * BUSINESS_VIEWER: siempre su negocio (token). Roles de hub: pasan businessId.
 */
function getMyBusinessPortalSummary(req, res) {
    return __awaiter(this, void 0, void 0, function* () {
        const ctx = req.hubContext;
        try {
            const requested = typeof req.query.businessId === "string" ? req.query.businessId : undefined;
            const businessId = (0, auth_1.resolveScopedBusinessId)(ctx, requested);
            if (!businessId) {
                return res.status(400).json({
                    status: false,
                    statusCode: 400,
                    message: ctx.role === "BUSINESS_VIEWER" ? "Acceso sin negocio asignado" : "businessId es requerido",
                    data: {},
                });
            }
            // Candado de pertenencia + datos públicos del negocio para el header
            const business = yield (0, businessService_external_1.assertBusinessBelongsToHub)(ctx.hubId, businessId);
            const from = typeof req.query.from === "string" ? req.query.from : undefined;
            const to = typeof req.query.to === "string" ? req.query.to : undefined;
            const summaryResp = yield (0, ordersService_external_1.getHubOrdersSummary)(ctx.hubId, from, to, businessId);
            const summary = (summaryResp === null || summaryResp === void 0 ? void 0 : summaryResp.data) || { totalOrders: 0, totalSales: 0, byStatus: [], topProducts: [] };
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
        }
        catch (error) {
            if ((error === null || error === void 0 ? void 0 : error.code) === "BUSINESS_NOT_IN_HUB") {
                return res.status(403).json({
                    status: false,
                    statusCode: 403,
                    message: "El negocio no pertenece a este hub",
                    data: {},
                });
            }
            return upstreamError(res, error, "cargar el resumen del negocio");
        }
    });
}
/**
 * GET /api/hubs/me/dashboard?from=&to=
 * KPIs consolidados: totales del rango + por estado + por negocio (con nombre),
 * más métricas de uso/límites del hub.
 */
function getMyHubDashboard(req, res) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b;
        const ctx = req.hubContext;
        try {
            const from = typeof req.query.from === "string" ? req.query.from : undefined;
            const to = typeof req.query.to === "string" ? req.query.to : undefined;
            const [hub, summaryResp, businessesResp] = yield Promise.all([
                hubModel_1.default.findById(ctx.hubId).select("name slug usageMetrics subscription timezone currency"),
                (0, ordersService_external_1.getHubOrdersSummary)(ctx.hubId, from, to).catch((e) => {
                    var _a;
                    console.error("[dashboard] summary error:", ((_a = e === null || e === void 0 ? void 0 : e.response) === null || _a === void 0 ? void 0 : _a.data) || (e === null || e === void 0 ? void 0 : e.message));
                    return null;
                }),
                (0, businessService_external_1.getBusinessesByHubId)(ctx.hubId).catch(() => null),
            ]);
            if (!hub) {
                return res.status(404).json({ status: false, statusCode: 404, message: "Hub no encontrado", data: {} });
            }
            const businesses = ((_a = businessesResp === null || businessesResp === void 0 ? void 0 : businessesResp.data) === null || _a === void 0 ? void 0 : _a.businesses) || [];
            const nameById = new Map(businesses.map((b) => [String(b._id), b.name]));
            const summary = (summaryResp === null || summaryResp === void 0 ? void 0 : summaryResp.data) || { totalOrders: 0, totalSales: 0, byStatus: [], byBusiness: [] };
            const byBusiness = (summary.byBusiness || []).map((b) => (Object.assign(Object.assign({}, b), { name: nameById.get(String(b.businessId)) || b.businessId })));
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
                        limits: (_b = hub.subscription) === null || _b === void 0 ? void 0 : _b.limits,
                    },
                    summary: Object.assign(Object.assign({}, summary), { byBusiness }),
                    businesses: {
                        total: businesses.length,
                        active: businesses.filter((b) => (b.operationalStatus || "active") === "active").length,
                        paused: businesses.filter((b) => b.operationalStatus === "paused").length,
                        temporarilyClosed: businesses.filter((b) => b.operationalStatus === "temporarily_closed").length,
                    },
                },
            });
        }
        catch (error) {
            return upstreamError(res, error, "cargar el dashboard");
        }
    });
}
