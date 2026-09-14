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
exports.generateMyDriverSettlements = generateMyDriverSettlements;
exports.listMyDriverSettlements = listMyDriverSettlements;
exports.getMyDriverSettlementDetail = getMyDriverSettlementDetail;
exports.markMyDriverSettlementPaid = markMyDriverSettlementPaid;
exports.addMyDriverSettlementAdjustment = addMyDriverSettlementAdjustment;
exports.removeMyDriverSettlementAdjustment = removeMyDriverSettlementAdjustment;
exports.getMyDriverAccount = getMyDriverAccount;
const mongoose_1 = require("mongoose");
const hubModel_1 = __importDefault(require("../models/hubModel"));
const hubUserModel_1 = __importDefault(require("../models/hubUserModel"));
const hubDriverSettlementModel_1 = __importDefault(require("../models/hubDriverSettlementModel"));
const ordersService_external_1 = require("../services/ordersService.external");
const businessService_external_1 = require("../services/businessService.external");
const settlementPeriods_1 = require("../utils/settlementPeriods");
const driverPay_1 = require("../utils/driverPay");
// ════════════════════════════════════════════════════════════════════════════
// Sprint 5 — Liquidación de repartidores (reemplaza el Excel del courier).
//
// Por período y repartidor: entregas, lo que cobró al cliente (efectivo /
// billetera), su comisión según la regla del hub (o su override) y ajustes
// (bonos + / descuentos −). netToHub > 0 = el repartidor le entrega dinero al
// hub; < 0 = el hub le paga. Ordena NO mueve el dinero: solo registra y marca
// "Pagada". Las liquidaciones PAGADAS jamás se recalculan.
// ════════════════════════════════════════════════════════════════════════════
const OBJECT_ID = /^[0-9a-fA-F]{24}$/;
const DEFAULT_TZ = "America/El_Salvador";
const PERIOD_HELP = "period inválido: usa YYYY-MM-DD (diario), YYYY-Www (semanal), YYYY-MM-Q1|Q2 (quincenal) o YYYY-MM (mensual)";
function fail(res, statusCode, message) {
    return res.status(statusCode).json({ status: false, statusCode, message, data: {} });
}
/** Errores 4xx de orders se propagan tal cual; lo demás es 502 (mismo patrón que hubOrderFlow). */
function upstream(res, error, action) {
    var _a, _b, _c;
    const st = (_a = error === null || error === void 0 ? void 0 : error.response) === null || _a === void 0 ? void 0 : _a.status;
    if (st && st >= 400 && st < 500 && ((_b = error === null || error === void 0 ? void 0 : error.response) === null || _b === void 0 ? void 0 : _b.data)) {
        return res.status(st).json(error.response.data);
    }
    console.error(`Error en ${action}:`, ((_c = error === null || error === void 0 ? void 0 : error.response) === null || _c === void 0 ? void 0 : _c.data) || (error === null || error === void 0 ? void 0 : error.message) || error);
    return res.status(502).json({
        status: false,
        statusCode: 502,
        message: `No se pudo ${action} (orders-service respondió ${st !== null && st !== void 0 ? st : "sin conexión"})`,
        data: {},
    });
}
/** Quién ejecuta la acción (nombre o email) para paidBy / createdBy. */
function actorLabel(ctx) {
    return __awaiter(this, void 0, void 0, function* () {
        let label = ctx.email;
        try {
            const u = yield hubUserModel_1.default.findById(ctx.userId).select("name email").lean();
            if (u === null || u === void 0 ? void 0 : u.name)
                label = String(u.name);
            else if (u === null || u === void 0 ? void 0 : u.email)
                label = String(u.email);
        }
        catch (_a) {
            /* el email del token basta */
        }
        return String(label || "").slice(0, 120);
    });
}
const num = (v, fallback = 0) => (typeof v === "number" && Number.isFinite(v) ? v : fallback);
/** Línea de orders → línea de la liquidación (con nombre del negocio y comisión). */
function buildLine(raw, rule, businessNames) {
    const orderTotal = (0, settlementPeriods_1.round2)(num(raw === null || raw === void 0 ? void 0 : raw.orderTotal));
    const deliveryCost = (0, settlementPeriods_1.round2)(num(raw === null || raw === void 0 ? void 0 : raw.deliveryCost));
    const collectedByDriver = (raw === null || raw === void 0 ? void 0 : raw.collectedByDriver) === true;
    const deliveredAt = (raw === null || raw === void 0 ? void 0 : raw.deliveredAt) ? new Date(raw.deliveredAt) : null;
    return {
        orderId: String((raw === null || raw === void 0 ? void 0 : raw.orderId) || ""),
        orderNumber: typeof (raw === null || raw === void 0 ? void 0 : raw.orderNumber) === "number" ? raw.orderNumber : null,
        businessId: String((raw === null || raw === void 0 ? void 0 : raw.businessId) || ""),
        businessName: businessNames.get(String((raw === null || raw === void 0 ? void 0 : raw.businessId) || "")) || null,
        deliveredAt: deliveredAt && !isNaN(deliveredAt.getTime()) ? deliveredAt : null,
        orderTotal,
        deliveryCost,
        distanceKm: typeof (raw === null || raw === void 0 ? void 0 : raw.distanceKm) === "number" && Number.isFinite(raw.distanceKm) ? raw.distanceKm : null,
        paymentType: (raw === null || raw === void 0 ? void 0 : raw.paymentType) ? String(raw.paymentType) : null,
        collectedByDriver,
        collectedMethod: (raw === null || raw === void 0 ? void 0 : raw.collectedMethod) ? String(raw.collectedMethod) : null,
        collectedAmount: collectedByDriver ? (0, settlementPeriods_1.round2)(num(raw === null || raw === void 0 ? void 0 : raw.collectedAmount)) : 0,
        commissionAmount: (0, driverPay_1.computeDriverCommission)(rule, { orderTotal, deliveryCost }),
    };
}
/**
 * Totales del período a partir de la respuesta de orders. Los agregados vienen
 * de orders (cubren TODO el rango aunque las líneas estén truncadas); la
 * comisión sale de las líneas — salvo 'fixed', que se calcula sobre el conteo
 * total para no perder entregas si hubo truncado.
 */
function summarize(data, lines, rule) {
    const deliveriesCount = typeof (data === null || data === void 0 ? void 0 : data.deliveriesCount) === "number" && Number.isFinite(data.deliveriesCount) ? data.deliveriesCount : lines.length;
    const collectedTotal = (0, settlementPeriods_1.round2)(typeof (data === null || data === void 0 ? void 0 : data.collectedTotal) === "number" && Number.isFinite(data.collectedTotal)
        ? data.collectedTotal
        : lines.reduce((acc, l) => acc + (l.collectedByDriver ? l.collectedAmount : 0), 0));
    const deliveryFeesTotal = (0, settlementPeriods_1.round2)(typeof (data === null || data === void 0 ? void 0 : data.deliveryFeesTotal) === "number" && Number.isFinite(data.deliveryFeesTotal)
        ? data.deliveryFeesTotal
        : lines.reduce((acc, l) => acc + l.deliveryCost, 0));
    const orderTotalsTotal = (0, settlementPeriods_1.round2)(typeof (data === null || data === void 0 ? void 0 : data.orderTotalsTotal) === "number" && Number.isFinite(data.orderTotalsTotal)
        ? data.orderTotalsTotal
        : lines.reduce((acc, l) => acc + l.orderTotal, 0));
    const commissionAmount = rule.commissionType === "fixed"
        ? (0, settlementPeriods_1.round2)(deliveriesCount * rule.commissionValue)
        : (0, settlementPeriods_1.round2)(lines.reduce((acc, l) => acc + l.commissionAmount, 0));
    return { deliveriesCount, collectedTotal, deliveryFeesTotal, orderTotalsTotal, commissionAmount };
}
/** adjustmentsTotal / driverEarnings / netToHub a partir de cobrado, comisión y ajustes. */
function recalc(collectedTotal, commissionAmount, adjustments) {
    const adjustmentsTotal = (0, settlementPeriods_1.round2)(adjustments.reduce((acc, a) => acc + num(a === null || a === void 0 ? void 0 : a.amount), 0));
    const driverEarnings = (0, settlementPeriods_1.round2)(commissionAmount + adjustmentsTotal);
    const netToHub = (0, settlementPeriods_1.round2)(collectedTotal - driverEarnings);
    return { adjustmentsTotal, driverEarnings, netToHub };
}
/** Nombres de los negocios del hub (una sola llamada; best-effort: sin nombre no se frena la liquidación). */
function businessNamesFor(hubId) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a;
        const map = new Map();
        try {
            const resp = yield (0, businessService_external_1.getBusinessesByHubId)(hubId);
            for (const b of ((_a = resp === null || resp === void 0 ? void 0 : resp.data) === null || _a === void 0 ? void 0 : _a.businesses) || [])
                map.set(String(b._id), String(b.name || ""));
        }
        catch (e) {
            console.error("[driver-settlements] no se pudieron leer los negocios del hub:", e === null || e === void 0 ? void 0 : e.message);
        }
        return map;
    });
}
// ── Hub (HUB_OWNER / HUB_ADMIN) ──
/**
 * POST /api/hubs/me/driver-settlements/generate
 * Body: { period, driverId? }. Genera (o RE-genera mientras no esté PAID) la
 * liquidación del período para un repartidor o para todos los del hub. Las
 * líneas salen de orders (entregas del repartidor con su cobro); la comisión,
 * de la regla del hub o del override del repartidor. Los ajustes de una
 * liquidación PENDIENTE se conservan al regenerar.
 */
function generateMyDriverSettlements(req, res) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b;
        const ctx = req.hubContext;
        try {
            const period = String(((_a = req.body) === null || _a === void 0 ? void 0 : _a.period) || "").trim();
            if (!(0, settlementPeriods_1.detectPeriodFrequency)(period))
                return fail(res, 400, PERIOD_HELP);
            const requestedDriverId = ((_b = req.body) === null || _b === void 0 ? void 0 : _b.driverId) ? String(req.body.driverId).trim() : null;
            if (requestedDriverId && !OBJECT_ID.test(requestedDriverId))
                return fail(res, 400, "driverId inválido");
            const hub = yield hubModel_1.default
                .findById(ctx.hubId)
                .select("timezone currency driverPayConfig driverCommissionOverrides")
                .lean();
            if (!hub)
                return fail(res, 404, "Hub no encontrado");
            const { start, end, frequency } = (0, settlementPeriods_1.periodRangeInTz)(period, hub.timezone || DEFAULT_TZ);
            const driverFilter = { hub_id: ctx.hubId, role: "DELIVERY_DRIVER" };
            if (requestedDriverId)
                driverFilter._id = requestedDriverId;
            const drivers = yield hubUserModel_1.default.find(driverFilter).select("name email").sort({ name: 1, created_at: 1 }).lean();
            if (requestedDriverId && drivers.length === 0)
                return fail(res, 404, "Repartidor no encontrado en este hub");
            if (drivers.length === 0)
                return fail(res, 400, "El hub no tiene repartidores");
            const businessNames = yield businessNamesFor(ctx.hubId);
            const results = [];
            const skippedPaid = [];
            for (const driver of drivers) {
                const driverId = String(driver._id);
                const existing = yield hubDriverSettlementModel_1.default
                    .findOne({ hubId: ctx.hubId, driverId, period })
                    .select("status adjustments")
                    .lean();
                if ((existing === null || existing === void 0 ? void 0 : existing.status) === "PAID") {
                    // Una liquidación pagada es un documento histórico: jamás se pisa.
                    skippedPaid.push(driverId);
                    continue;
                }
                const linesResp = yield (0, ordersService_external_1.getDriverSettlementLines)(ctx.hubId, driverId, start.toISOString(), end.toISOString());
                const data = ((linesResp === null || linesResp === void 0 ? void 0 : linesResp.data) || {});
                const rule = (0, driverPay_1.resolveDriverPayRule)(hub, driverId);
                const lines = (Array.isArray(data.lines) ? data.lines : []).map((l) => buildLine(l, rule, businessNames));
                const totals = summarize(data, lines, rule);
                const adjustments = Array.isArray(existing === null || existing === void 0 ? void 0 : existing.adjustments) ? existing.adjustments : [];
                const derived = recalc(totals.collectedTotal, totals.commissionAmount, adjustments);
                const now = new Date();
                const doc = yield hubDriverSettlementModel_1.default
                    .findOneAndUpdate({ hubId: ctx.hubId, driverId, period, status: { $ne: "PAID" } }, {
                    $set: {
                        driverName: driver.name ? String(driver.name) : driver.email ? String(driver.email) : null,
                        driverEmail: driver.email ? String(driver.email) : null,
                        frequency,
                        periodStart: start,
                        periodEnd: end,
                        deliveriesCount: totals.deliveriesCount,
                        collectedTotal: totals.collectedTotal,
                        deliveryFeesTotal: totals.deliveryFeesTotal,
                        orderTotalsTotal: totals.orderTotalsTotal,
                        commissionType: rule.commissionType,
                        commissionValue: rule.commissionValue,
                        percentBase: rule.percentBase,
                        commissionAmount: totals.commissionAmount,
                        adjustments,
                        adjustmentsTotal: derived.adjustmentsTotal,
                        driverEarnings: derived.driverEarnings,
                        netToHub: derived.netToHub,
                        currency: hub.currency || "USD",
                        lines,
                        linesTruncated: !!data.truncated,
                        status: "PENDING",
                        generatedAt: now,
                        updated_at: now,
                    },
                    $setOnInsert: { created_at: now },
                }, { upsert: true, new: true, setDefaultsOnInsert: true })
                    .select("-lines")
                    .lean();
                results.push(doc);
            }
            return res.status(200).json({
                status: true,
                statusCode: 200,
                message: `Liquidaciones de repartidores generadas (${results.length})${skippedPaid.length ? ` — ${skippedPaid.length} ya pagadas, intactas` : ""}`,
                data: { settlements: results, skippedPaid },
            });
        }
        catch (error) {
            return upstream(res, error, "generar las liquidaciones de repartidores");
        }
    });
}
/** GET /api/hubs/me/driver-settlements?period=&driverId=  (HUB_OWNER / HUB_ADMIN) — sin líneas. */
function listMyDriverSettlements(req, res) {
    return __awaiter(this, void 0, void 0, function* () {
        const ctx = req.hubContext;
        try {
            const filter = { hubId: ctx.hubId };
            if (typeof req.query.period === "string" && req.query.period.trim())
                filter.period = req.query.period.trim();
            if (typeof req.query.driverId === "string" && req.query.driverId.trim())
                filter.driverId = req.query.driverId.trim();
            const settlements = yield hubDriverSettlementModel_1.default
                .find(filter)
                .select("-lines")
                .sort({ period: -1, driverName: 1 })
                .limit(200)
                .lean();
            return res.status(200).json({ status: true, statusCode: 200, message: "Liquidaciones de repartidores", data: { settlements } });
        }
        catch (error) {
            console.error("Error listando liquidaciones de repartidores:", error);
            return fail(res, 500, "Error interno del servidor");
        }
    });
}
/**
 * GET /api/hubs/me/driver-settlements/:id  (HUB_OWNER / HUB_ADMIN, y el DELIVERY_DRIVER dueño)
 * Con líneas (sin PII: nunca llevaron datos del cliente).
 */
function getMyDriverSettlementDetail(req, res) {
    return __awaiter(this, void 0, void 0, function* () {
        const ctx = req.hubContext;
        try {
            const id = String(req.params.id || "");
            if (!OBJECT_ID.test(id))
                return fail(res, 404, "Liquidación no encontrada");
            const doc = yield hubDriverSettlementModel_1.default.findOne({ _id: id, hubId: ctx.hubId }).lean();
            if (!doc)
                return fail(res, 404, "Liquidación no encontrada");
            if (ctx.role === "DELIVERY_DRIVER" && String(doc.driverId) !== String(ctx.userId)) {
                return fail(res, 403, "No tienes acceso a esta liquidación");
            }
            return res.status(200).json({ status: true, statusCode: 200, message: "Liquidación", data: { settlement: doc } });
        }
        catch (error) {
            console.error("Error leyendo liquidación de repartidor:", error);
            return fail(res, 500, "Error interno del servidor");
        }
    });
}
/**
 * PATCH /api/hubs/me/driver-settlements/:id/paid  (HUB_OWNER / HUB_ADMIN)
 * Body: { reference? }. El dinero se movió POR FUERA; aquí solo queda el registro.
 * Idempotente: si ya estaba PAID responde 200 con el documento tal cual.
 */
function markMyDriverSettlementPaid(req, res) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a;
        const ctx = req.hubContext;
        try {
            const id = String(req.params.id || "");
            if (!OBJECT_ID.test(id))
                return fail(res, 404, "Liquidación no encontrada");
            const reference = typeof ((_a = req.body) === null || _a === void 0 ? void 0 : _a.reference) === "string" ? req.body.reference.trim().slice(0, 200) || null : null;
            const current = yield hubDriverSettlementModel_1.default.findOne({ _id: id, hubId: ctx.hubId }).lean();
            if (!current)
                return fail(res, 404, "Liquidación no encontrada");
            if (current.status === "PAID") {
                return res.status(200).json({ status: true, statusCode: 200, message: "La liquidación ya estaba pagada", data: { settlement: current } });
            }
            const now = new Date();
            const paidBy = yield actorLabel(ctx);
            let doc = yield hubDriverSettlementModel_1.default
                .findOneAndUpdate({ _id: id, hubId: ctx.hubId, status: "PENDING" }, { $set: { status: "PAID", paidAt: now, paidReference: reference, paidBy, updated_at: now } }, { new: true })
                .lean();
            if (!doc) {
                // Carrera: alguien la pagó entre la lectura y el update → idempotente.
                doc = yield hubDriverSettlementModel_1.default.findOne({ _id: id, hubId: ctx.hubId }).lean();
                if (!doc)
                    return fail(res, 404, "Liquidación no encontrada");
            }
            return res.status(200).json({ status: true, statusCode: 200, message: "Liquidación marcada como pagada", data: { settlement: doc } });
        }
        catch (error) {
            console.error("Error marcando liquidación de repartidor:", error);
            return fail(res, 500, "Error interno del servidor");
        }
    });
}
/**
 * POST /api/hubs/me/driver-settlements/:id/adjustments  (HUB_OWNER / HUB_ADMIN)
 * Body: { concept (1–120), amount (≠ 0; positivo = bono, negativo = descuento) }.
 * 409 si la liquidación ya está pagada. Recalcula adjustmentsTotal/driverEarnings/netToHub.
 */
function addMyDriverSettlementAdjustment(req, res) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b;
        const ctx = req.hubContext;
        try {
            const id = String(req.params.id || "");
            if (!OBJECT_ID.test(id))
                return fail(res, 404, "Liquidación no encontrada");
            const concept = typeof ((_a = req.body) === null || _a === void 0 ? void 0 : _a.concept) === "string" ? req.body.concept.trim() : "";
            if (concept.length < 1 || concept.length > 120)
                return fail(res, 400, "concept es requerido (1 a 120 caracteres)");
            const rawAmount = (_b = req.body) === null || _b === void 0 ? void 0 : _b.amount;
            const amount = typeof rawAmount === "number" && Number.isFinite(rawAmount) ? (0, settlementPeriods_1.round2)(rawAmount) : NaN;
            if (!Number.isFinite(amount) || amount === 0)
                return fail(res, 400, "amount debe ser un número distinto de 0");
            const current = yield hubDriverSettlementModel_1.default.findOne({ _id: id, hubId: ctx.hubId }).lean();
            if (!current)
                return fail(res, 404, "Liquidación no encontrada");
            if (current.status === "PAID")
                return fail(res, 409, "La liquidación ya está pagada: no admite ajustes");
            const now = new Date();
            const adjustment = {
                id: new mongoose_1.Types.ObjectId().toString(),
                concept,
                amount,
                createdBy: yield actorLabel(ctx),
                createdAt: now,
            };
            const adjustments = [...(Array.isArray(current.adjustments) ? current.adjustments : []), adjustment];
            const derived = recalc(num(current.collectedTotal), num(current.commissionAmount), adjustments);
            const doc = yield hubDriverSettlementModel_1.default
                .findOneAndUpdate({ _id: id, hubId: ctx.hubId, status: "PENDING" }, { $set: Object.assign(Object.assign({ adjustments }, derived), { updated_at: now }) }, { new: true })
                .lean();
            if (!doc)
                return fail(res, 409, "La liquidación ya está pagada: no admite ajustes");
            return res.status(200).json({ status: true, statusCode: 200, message: "Ajuste agregado", data: { settlement: doc, adjustment } });
        }
        catch (error) {
            console.error("Error agregando ajuste:", error);
            return fail(res, 500, "Error interno del servidor");
        }
    });
}
/**
 * DELETE /api/hubs/me/driver-settlements/:id/adjustments/:adjustmentId  (HUB_OWNER / HUB_ADMIN)
 * 409 si la liquidación ya está pagada. Recalcula totales.
 */
function removeMyDriverSettlementAdjustment(req, res) {
    return __awaiter(this, void 0, void 0, function* () {
        const ctx = req.hubContext;
        try {
            const id = String(req.params.id || "");
            const adjustmentId = String(req.params.adjustmentId || "");
            if (!OBJECT_ID.test(id))
                return fail(res, 404, "Liquidación no encontrada");
            const current = yield hubDriverSettlementModel_1.default.findOne({ _id: id, hubId: ctx.hubId }).lean();
            if (!current)
                return fail(res, 404, "Liquidación no encontrada");
            if (current.status === "PAID")
                return fail(res, 409, "La liquidación ya está pagada: no admite ajustes");
            const before = Array.isArray(current.adjustments) ? current.adjustments : [];
            const adjustments = before.filter((a) => String(a === null || a === void 0 ? void 0 : a.id) !== adjustmentId);
            if (adjustments.length === before.length)
                return fail(res, 404, "Ajuste no encontrado");
            const derived = recalc(num(current.collectedTotal), num(current.commissionAmount), adjustments);
            const now = new Date();
            const doc = yield hubDriverSettlementModel_1.default
                .findOneAndUpdate({ _id: id, hubId: ctx.hubId, status: "PENDING" }, { $set: Object.assign(Object.assign({ adjustments }, derived), { updated_at: now }) }, { new: true })
                .lean();
            if (!doc)
                return fail(res, 409, "La liquidación ya está pagada: no admite ajustes");
            return res.status(200).json({ status: true, statusCode: 200, message: "Ajuste eliminado", data: { settlement: doc } });
        }
        catch (error) {
            console.error("Error eliminando ajuste:", error);
            return fail(res, 500, "Error interno del servidor");
        }
    });
}
// ── App del repartidor (DELIVERY_DRIVER) ──
/**
 * GET /api/hubs/me/driver/account
 * "Mi cuenta" del repartidor: hoy y el período de corte actual (entregas, cobrado,
 * comisión y neto contra el hub, en vivo desde orders), la regla que le aplica y
 * sus últimas 12 liquidaciones (sin líneas). Solo SUS datos (driverId = JWT).
 */
function getMyDriverAccount(req, res) {
    return __awaiter(this, void 0, void 0, function* () {
        const ctx = req.hubContext;
        try {
            const hub = yield hubModel_1.default
                .findById(ctx.hubId)
                .select("timezone currency driverPayConfig driverCommissionOverrides")
                .lean();
            if (!hub)
                return fail(res, 404, "Hub no encontrado");
            const tz = hub.timezone || DEFAULT_TZ;
            const cfg = (0, driverPay_1.resolveDriverPayConfig)(hub);
            const rule = (0, driverPay_1.resolveDriverPayRule)(hub, ctx.userId);
            const now = new Date();
            const todayKey = (0, settlementPeriods_1.currentPeriodKey)("daily", tz, now);
            const todayRange = (0, settlementPeriods_1.periodRangeInTz)(todayKey, tz);
            const currentKey = (0, settlementPeriods_1.currentPeriodKey)(cfg.frequency, tz, now);
            const currentRange = (0, settlementPeriods_1.periodRangeInTz)(currentKey, tz);
            const sameRange = cfg.frequency === "daily";
            const noNames = new Map();
            const [todayResp, currentResp] = yield Promise.all([
                (0, ordersService_external_1.getDriverSettlementLines)(ctx.hubId, ctx.userId, todayRange.start.toISOString(), todayRange.end.toISOString()),
                sameRange
                    ? Promise.resolve(null)
                    : (0, ordersService_external_1.getDriverSettlementLines)(ctx.hubId, ctx.userId, currentRange.start.toISOString(), currentRange.end.toISOString()),
            ]);
            const block = (resp) => {
                const data = ((resp === null || resp === void 0 ? void 0 : resp.data) || {});
                const lines = (Array.isArray(data.lines) ? data.lines : []).map((l) => buildLine(l, rule, noNames));
                const t = summarize(data, lines, rule);
                return {
                    deliveries: t.deliveriesCount,
                    collected: t.collectedTotal,
                    commission: t.commissionAmount,
                    netToHub: (0, settlementPeriods_1.round2)(t.collectedTotal - t.commissionAmount),
                };
            };
            const todayBlock = block(todayResp);
            const currentBlock = sameRange ? todayBlock : block(currentResp);
            const settlements = yield hubDriverSettlementModel_1.default
                .find({ hubId: ctx.hubId, driverId: ctx.userId })
                .select("period frequency status deliveriesCount collectedTotal commissionAmount adjustmentsTotal driverEarnings netToHub paidAt paidReference currency")
                .sort({ period: -1 })
                .limit(12)
                .lean();
            return res.status(200).json({
                status: true,
                statusCode: 200,
                message: "Cuenta del repartidor",
                data: {
                    today: Object.assign({ period: todayKey }, todayBlock),
                    currentPeriod: Object.assign({ period: currentKey, frequency: cfg.frequency }, currentBlock),
                    rule: {
                        commissionType: rule.commissionType,
                        commissionValue: rule.commissionValue,
                        percentBase: rule.percentBase,
                        frequency: cfg.frequency,
                    },
                    settlements,
                    currency: hub.currency || "USD",
                    timezone: tz,
                },
            });
        }
        catch (error) {
            return upstream(res, error, "leer la cuenta del repartidor");
        }
    });
}
