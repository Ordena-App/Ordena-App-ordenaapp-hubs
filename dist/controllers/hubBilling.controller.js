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
var __rest = (this && this.__rest) || function (s, e) {
    var t = {};
    for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p) && e.indexOf(p) < 0)
        t[p] = s[p];
    if (s != null && typeof Object.getOwnPropertySymbols === "function")
        for (var i = 0, p = Object.getOwnPropertySymbols(s); i < p.length; i++) {
            if (e.indexOf(p[i]) < 0 && Object.prototype.propertyIsEnumerable.call(s, p[i]))
                t[p[i]] = s[p[i]];
        }
    return t;
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.patchHubSubscriptionInternal = patchHubSubscriptionInternal;
exports.getHubPlansPublic = getHubPlansPublic;
exports.getMyHubBilling = getMyHubBilling;
exports.createMyHubCheckoutSession = createMyHubCheckoutSession;
exports.createMyHubPortalSession = createMyHubPortalSession;
exports.claimHubOverageInternal = claimHubOverageInternal;
exports.markHubOverageInvoicedInternal = markHubOverageInvoicedInternal;
const hubModel_1 = __importDefault(require("../models/hubModel"));
const hubPlanModel_1 = __importDefault(require("../models/hubPlanModel"));
const hubUsageLedgerModel_1 = __importDefault(require("../models/hubUsageLedgerModel"));
const hubUsageReconcile_service_1 = require("../services/hubUsageReconcile.service");
const applyHubPlan_1 = require("../utils/applyHubPlan");
const paymentsBilling_external_1 = require("../services/paymentsBilling.external");
const config_1 = require("../config/config");
function isValidInternalCall(req) {
    if (!config_1.INTERNAL_SHARED_SECRET)
        return false;
    const header = (req.headers["x-ordena-secret"] || req.headers["X-Ordena-Secret"]);
    return header === config_1.INTERNAL_SHARED_SECRET;
}
function upstreamError(res, error, action) {
    var _a, _b, _c;
    const upstreamStatus = (_a = error === null || error === void 0 ? void 0 : error.response) === null || _a === void 0 ? void 0 : _a.status;
    if (upstreamStatus && upstreamStatus >= 400 && upstreamStatus < 500 && ((_b = error === null || error === void 0 ? void 0 : error.response) === null || _b === void 0 ? void 0 : _b.data)) {
        return res.status(upstreamStatus).json(error.response.data);
    }
    console.error(`Error en ${action}:`, ((_c = error === null || error === void 0 ? void 0 : error.response) === null || _c === void 0 ? void 0 : _c.data) || (error === null || error === void 0 ? void 0 : error.message) || error);
    return res.status(502).json({
        status: false,
        statusCode: 502,
        message: `No se pudo ${action} (payments-service respondió ${upstreamStatus !== null && upstreamStatus !== void 0 ? upstreamStatus : "sin conexión"})`,
        data: {},
    });
}
/**
 * PATCH /api/hubs/internal/:hubId/subscription  (interno — lo llama payments
 * desde el webhook de Stripe). Body: { lookupKey, status?, periodStart?,
 * periodEnd?, billingCycle? }. Resuelve el plan por lookupKey en hub_plans y
 * aplica el snapshot vía applyPlanToHub (único camino de escritura).
 */
function patchHubSubscriptionInternal(req, res) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a;
        try {
            if (!isValidInternalCall(req)) {
                return res.status(403).json({ status: false, statusCode: 403, message: "Llamada interna no autorizada", data: {} });
            }
            const hubId = String(req.params.hubId);
            const { lookupKey, status, periodStart, periodEnd, billingCycle } = req.body || {};
            if (!lookupKey || typeof lookupKey !== "string") {
                return res.status(400).json({ status: false, statusCode: 400, message: "lookupKey es requerido", data: {} });
            }
            const hub = yield hubModel_1.default.findById(hubId).select("_id");
            if (!hub) {
                return res.status(404).json({ status: false, statusCode: 404, message: "Hub no encontrado", data: {} });
            }
            // Mora: sellar desde cuándo (para la escalación del día 15) y limpiarla
            // al volver a estar al día. Se hace aparte de applyPlanToHub porque es
            // una transición de estado, no parte del snapshot del plan.
            if (typeof status === "string") {
                if (status === "PAST_DUE") {
                    yield hubModel_1.default.updateOne({ _id: hubId, "subscription.pastDueSince": null }, { $set: { "subscription.pastDueSince": new Date() } });
                }
                else if (status === "ACTIVE" || status === "TRIAL") {
                    yield hubModel_1.default.updateOne({ _id: hubId }, { $set: { "subscription.pastDueSince": null } });
                }
            }
            const plan = yield hubPlanModel_1.default.findOne({ lookupKeys: lookupKey, is_active: true }).lean();
            yield (0, applyHubPlan_1.applyPlanToHub)({
                hubId,
                lookupKey,
                status: typeof status === "string" ? status : undefined,
                periodStart: periodStart || null,
                periodEnd: periodEnd || null,
                billingCycle: billingCycle === "yearly" ? "yearly" : billingCycle === "monthly" ? "monthly" : undefined,
                plan: plan,
            });
            return res.status(200).json({
                status: true,
                statusCode: 200,
                message: "Suscripción del hub actualizada",
                data: { planCode: (_a = plan === null || plan === void 0 ? void 0 : plan.code) !== null && _a !== void 0 ? _a : null, planFound: !!plan },
            });
        }
        catch (error) {
            console.error("Error en patchHubSubscriptionInternal:", error);
            return res.status(500).json({ status: false, statusCode: 500, message: "Error interno del servidor", data: {} });
        }
    });
}
/**
 * GET /api/hubs/plans  (público) — catálogo para la vitrina de planes.
 * Solo isPublic + is_active; sin lookupKeys (el checkout valida server-side).
 */
function getHubPlansPublic(_req, res) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            const docs = yield hubPlanModel_1.default
                .find({ isPublic: true, is_active: true })
                .select("code name description price currency billingCycle limits lookupKeys")
                .sort({ price: 1 })
                .lean();
            // El frontend no adivina lookup keys por convención: el catálogo dice
            // con cuál se hace checkout (el primero del plan). No es secreto — el
            // checkout re-valida contra hub_plans de todas formas.
            const plans = docs.map((d) => {
                const { lookupKeys } = d, rest = __rest(d, ["lookupKeys"]);
                return Object.assign(Object.assign({}, rest), { checkoutLookupKey: Array.isArray(lookupKeys) ? lookupKeys[0] || null : null });
            });
            return res.status(200).json({
                status: true,
                statusCode: 200,
                message: "Planes de hub",
                data: { plans },
            });
        }
        catch (error) {
            console.error("Error en getHubPlansPublic:", error);
            return res.status(500).json({ status: false, statusCode: 500, message: "Error interno del servidor", data: {} });
        }
    });
}
/**
 * GET /api/hubs/me/billing  (HUB_OWNER / HUB_ADMIN)
 * Plan actual + límites (snapshot) + uso del mes + excedente proyectado.
 * Los números salen de aquí — el frontend no replica precios ni límites.
 */
function getMyHubBilling(req, res) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b, _c;
        try {
            const ctx = req.hubContext;
            const hub = yield hubModel_1.default.findById(ctx.hubId).select("subscription usageMetrics currency").lean();
            if (!hub) {
                return res.status(404).json({ status: false, statusCode: 404, message: "Hub no encontrado", data: {} });
            }
            const sub = hub.subscription || {};
            const usage = hub.usageMetrics || {};
            const limits = sub.limits || {};
            const plan = ((_a = sub.planRef) === null || _a === void 0 ? void 0 : _a.code)
                ? yield hubPlanModel_1.default.findOne({ code: sub.planRef.code }).select("code name price currency billingCycle").lean()
                : null;
            // Excedente proyectado del mes EN CURSO (informativo — la factura real
            // se arma re-contando orders al cierre del período, no con el contador).
            const ordersLimit = (_b = limits.ordersPerMonth) !== null && _b !== void 0 ? _b : -1;
            const ordersUsed = usage.ordersCurrentMonth || 0;
            const extraOrders = ordersLimit === -1 ? 0 : Math.max(0, ordersUsed - ordersLimit);
            const businessesIncluded = (_c = limits.businessesIncluded) !== null && _c !== void 0 ? _c : -1;
            const businessesCount = usage.businessesCount || 0;
            const extraBusinesses = businessesIncluded === -1 ? 0 : Math.max(0, businessesCount - businessesIncluded);
            const projectedOverage = extraOrders * (limits.extraOrderPrice || 0) + extraBusinesses * (limits.extraBusinessPrice || 0);
            // Último período cerrado (para que la factura nunca sorprenda).
            const lastLedger = yield hubUsageLedgerModel_1.default
                .findOne({ hubId: ctx.hubId })
                .sort({ periodEnd: -1 })
                .select("period extraOrders extraBusinesses totalAmount currency status periodStart periodEnd")
                .lean();
            return res.status(200).json({
                status: true,
                statusCode: 200,
                message: "Facturación del hub",
                data: {
                    lastLedger,
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
        }
        catch (error) {
            console.error("Error en getMyHubBilling:", error);
            return res.status(500).json({ status: false, statusCode: 500, message: "Error interno del servidor", data: {} });
        }
    });
}
/**
 * POST /api/hubs/me/billing/checkout-session  (HUB_OWNER)
 * Body: { lookupKey, trialDays? }. El lookupKey DEBE existir en hub_plans:
 * impide usar este proxy para suscribirse a un plan CORE (o a cualquier price
 * ajeno) con el JWT del hub.
 */
function createMyHubCheckoutSession(req, res) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b;
        const ctx = req.hubContext;
        try {
            const lookupKey = String(((_a = req.body) === null || _a === void 0 ? void 0 : _a.lookupKey) || "").trim();
            if (!lookupKey) {
                return res.status(400).json({ status: false, statusCode: 400, message: "lookupKey es requerido", data: {} });
            }
            const plan = yield hubPlanModel_1.default.findOne({ lookupKeys: lookupKey, is_active: true }).select("code").lean();
            if (!plan) {
                return res.status(400).json({ status: false, statusCode: 400, message: "Ese plan no existe en el catálogo de hubs", data: {} });
            }
            const rawTrial = Number((_b = req.body) === null || _b === void 0 ? void 0 : _b.trialDays);
            const trialDays = Number.isFinite(rawTrial) ? Math.min(30, Math.max(0, Math.floor(rawTrial))) : undefined;
            const hub = yield hubModel_1.default.findById(ctx.hubId).select("slug").lean();
            const resp = yield (0, paymentsBilling_external_1.createHubCheckoutSessionExternal)({
                hubId: ctx.hubId,
                lookupKey,
                customerEmail: ctx.email,
                hubSlug: hub === null || hub === void 0 ? void 0 : hub.slug,
                trialDays,
            });
            return res.status(200).json(resp);
        }
        catch (error) {
            return upstreamError(res, error, "crear la sesión de pago");
        }
    });
}
/** POST /api/hubs/me/billing/portal-session  (HUB_OWNER) */
function createMyHubPortalSession(req, res) {
    return __awaiter(this, void 0, void 0, function* () {
        const ctx = req.hubContext;
        try {
            const resp = yield (0, paymentsBilling_external_1.createHubPortalSessionExternal)({ hubId: ctx.hubId });
            return res.status(200).json(resp);
        }
        catch (error) {
            return upstreamError(res, error, "abrir el portal de facturación");
        }
    });
}
/**
 * POST /api/hubs/internal/:hubId/billing/overage/claim  (interno — payments,
 * durante invoice.upcoming). Body: { periodStart, periodEnd }.
 * Re-cuenta el período desde orders y sella el ledger (DRAFT). Si ya estaba
 * INVOICED lo devuelve tal cual: el caller ve stripeInvoiceItemId y no re-cobra.
 */
function claimHubOverageInternal(req, res) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b;
        try {
            if (!isValidInternalCall(req)) {
                return res.status(403).json({ status: false, statusCode: 403, message: "Llamada interna no autorizada", data: {} });
            }
            const hubId = String(req.params.hubId);
            const periodStart = new Date(String(((_a = req.body) === null || _a === void 0 ? void 0 : _a.periodStart) || ""));
            const periodEnd = new Date(String(((_b = req.body) === null || _b === void 0 ? void 0 : _b.periodEnd) || ""));
            if (isNaN(periodStart.getTime()) || isNaN(periodEnd.getTime()) || periodEnd <= periodStart) {
                return res.status(400).json({ status: false, statusCode: 400, message: "periodStart/periodEnd inválidos", data: {} });
            }
            const ledger = yield (0, hubUsageReconcile_service_1.sealLedgerForPeriod)(hubId, periodStart, periodEnd);
            if (!ledger) {
                return res.status(404).json({ status: false, statusCode: 404, message: "Hub no encontrado", data: {} });
            }
            return res.status(200).json({ status: true, statusCode: 200, message: "Ledger sellado", data: { ledger } });
        }
        catch (error) {
            console.error("Error en claimHubOverageInternal:", error);
            return res.status(500).json({ status: false, statusCode: 500, message: "Error interno del servidor", data: {} });
        }
    });
}
/**
 * PATCH /api/hubs/internal/:hubId/billing/overage/:ledgerId/invoiced (interno)
 * Marca el ledger como INVOICED con el invoice item de Stripe como testigo.
 */
function markHubOverageInvoicedInternal(req, res) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a;
        try {
            if (!isValidInternalCall(req)) {
                return res.status(403).json({ status: false, statusCode: 403, message: "Llamada interna no autorizada", data: {} });
            }
            const hubId = String(req.params.hubId);
            const ledgerId = String(req.params.ledgerId);
            const stripeInvoiceItemId = String(((_a = req.body) === null || _a === void 0 ? void 0 : _a.stripeInvoiceItemId) || "");
            if (!stripeInvoiceItemId) {
                return res.status(400).json({ status: false, statusCode: 400, message: "stripeInvoiceItemId es requerido", data: {} });
            }
            const updated = yield hubUsageLedgerModel_1.default.findOneAndUpdate({ _id: ledgerId, hubId }, { $set: { status: "INVOICED", stripeInvoiceItemId, invoicedAt: new Date(), updated_at: new Date() } }, { new: true }).lean();
            if (!updated) {
                return res.status(404).json({ status: false, statusCode: 404, message: "Ledger no encontrado", data: {} });
            }
            return res.status(200).json({ status: true, statusCode: 200, message: "Ledger facturado", data: { ledger: updated } });
        }
        catch (error) {
            console.error("Error en markHubOverageInvoicedInternal:", error);
            return res.status(500).json({ status: false, statusCode: 500, message: "Error interno del servidor", data: {} });
        }
    });
}
