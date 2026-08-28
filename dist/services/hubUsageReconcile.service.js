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
exports.sealLedgerForPeriod = sealLedgerForPeriod;
const hubModel_1 = __importDefault(require("../models/hubModel"));
const hubUsageLedgerModel_1 = __importDefault(require("../models/hubUsageLedgerModel"));
const ordersService_external_1 = require("./ordersService.external");
/**
 * Cierre de período (F3 v2 fase 2): re-cuenta los pedidos del período desde
 * orders-service y sella el ledger del hub. ESTE número es el que se factura;
 * usageMetrics queda solo como barra de uso del dashboard.
 *
 * Idempotente: si el ledger del período ya está INVOICED no se toca (el cobro
 * ya salió); mientras está DRAFT se puede re-sellar (un reintento del webhook
 * con datos más frescos gana).
 */
function sealLedgerForPeriod(hubId, periodStart, periodEnd) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b, _c, _d, _e;
        const period = `${periodEnd.getUTCFullYear()}-${String(periodEnd.getUTCMonth() + 1).padStart(2, "0")}`;
        const existing = yield hubUsageLedgerModel_1.default.findOne({ hubId, period }).lean();
        if (existing && existing.status === "INVOICED") {
            return existing;
        }
        const hub = yield hubModel_1.default.findById(hubId).select("subscription usageMetrics").lean();
        if (!hub)
            return null;
        // Los límites que aplican son los del snapshot vigente (lo que el hub tenía
        // contratado durante el período), no los del catálogo de hoy.
        const limits = ((_a = hub.subscription) === null || _a === void 0 ? void 0 : _a.limits) || {};
        const ordersIncluded = (_b = limits.ordersPerMonth) !== null && _b !== void 0 ? _b : -1;
        const businessesIncluded = (_c = limits.businessesIncluded) !== null && _c !== void 0 ? _c : -1;
        const extraOrderPrice = limits.extraOrderPrice || 0;
        const extraBusinessPrice = limits.extraBusinessPrice || 0;
        // Re-conteo real (filtros espejo en orders: sin drafts/borrados/retenidos).
        const summaryResp = yield (0, ordersService_external_1.getHubOrdersSummary)(hubId, periodStart.toISOString(), periodEnd.toISOString());
        const ordersTotal = Number((_d = summaryResp === null || summaryResp === void 0 ? void 0 : summaryResp.data) === null || _d === void 0 ? void 0 : _d.totalOrders) || 0;
        const extraOrders = ordersIncluded === -1 ? 0 : Math.max(0, ordersTotal - ordersIncluded);
        const businessesCount = ((_e = hub.usageMetrics) === null || _e === void 0 ? void 0 : _e.businessesCount) || 0;
        const extraBusinesses = businessesIncluded === -1 ? 0 : Math.max(0, businessesCount - businessesIncluded);
        const extraOrdersAmount = Math.round(extraOrders * extraOrderPrice * 100) / 100;
        const extraBusinessesAmount = Math.round(extraBusinesses * extraBusinessPrice * 100) / 100;
        const totalAmount = Math.round((extraOrdersAmount + extraBusinessesAmount) * 100) / 100;
        const now = new Date();
        const ledger = yield hubUsageLedgerModel_1.default.findOneAndUpdate({ hubId, period, status: { $ne: "INVOICED" } }, {
            $set: {
                periodStart,
                periodEnd,
                ordersTotal,
                ordersIncluded,
                extraOrders,
                extraOrderPrice,
                extraOrdersAmount,
                businessesCount,
                businessesIncluded,
                extraBusinesses,
                extraBusinessPrice,
                extraBusinessesAmount,
                totalAmount,
                currency: "USD",
                status: "DRAFT",
                computedAt: now,
                updated_at: now,
            },
            $setOnInsert: { created_at: now },
        }, { upsert: true, new: true, setDefaultsOnInsert: true }).lean();
        return ledger;
    });
}
