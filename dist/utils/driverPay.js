"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DRIVER_PERCENT_BASES = exports.DRIVER_COMMISSION_TYPES = void 0;
exports.resolveDriverPayConfig = resolveDriverPayConfig;
exports.resolveDriverPayRule = resolveDriverPayRule;
exports.computeDriverCommission = computeDriverCommission;
const settlementPeriods_1 = require("./settlementPeriods");
exports.DRIVER_COMMISSION_TYPES = ["fixed", "percent", "none"];
exports.DRIVER_PERCENT_BASES = ["delivery_cost", "order_total"];
function sanitizeRule(raw, fallback) {
    const commissionType = exports.DRIVER_COMMISSION_TYPES.includes(raw === null || raw === void 0 ? void 0 : raw.commissionType) ? raw.commissionType : fallback.commissionType;
    const commissionValue = typeof (raw === null || raw === void 0 ? void 0 : raw.commissionValue) === "number" && Number.isFinite(raw.commissionValue) && raw.commissionValue >= 0
        ? raw.commissionValue
        : fallback.commissionValue;
    const percentBase = exports.DRIVER_PERCENT_BASES.includes(raw === null || raw === void 0 ? void 0 : raw.percentBase) ? raw.percentBase : fallback.percentBase;
    return { commissionType, commissionValue, percentBase };
}
const DEFAULT_RULE = { commissionType: "fixed", commissionValue: 0, percentBase: "delivery_cost" };
/** driverPayConfig del hub saneado (defaults: fixed 0, base delivery_cost, corte diario). */
function resolveDriverPayConfig(hub) {
    const cfg = (hub === null || hub === void 0 ? void 0 : hub.driverPayConfig) || {};
    const rule = sanitizeRule(cfg, DEFAULT_RULE);
    const frequency = ["daily", "weekly", "biweekly", "monthly"].includes(cfg === null || cfg === void 0 ? void 0 : cfg.frequency) ? cfg.frequency : "daily";
    return Object.assign(Object.assign({}, rule), { frequency });
}
/** Regla efectiva para UN repartidor: su override si existe, si no el default del hub. */
function resolveDriverPayRule(hub, driverId) {
    const base = resolveDriverPayConfig(hub);
    const override = (Array.isArray(hub === null || hub === void 0 ? void 0 : hub.driverCommissionOverrides) ? hub.driverCommissionOverrides : []).find((o) => String(o === null || o === void 0 ? void 0 : o.driverId) === String(driverId));
    if (!override)
        return { commissionType: base.commissionType, commissionValue: base.commissionValue, percentBase: base.percentBase };
    // El override es una regla completa: lo que no traiga válido cae al default del hub.
    return sanitizeRule(override, base);
}
/**
 * Comisión de UNA entrega según la regla resuelta:
 *   fixed   → commissionValue por entrega
 *   percent → (percentBase === 'order_total' ? total del pedido : costo de envío) × commissionValue / 100
 *   none    → 0
 */
function computeDriverCommission(rule, line) {
    if (rule.commissionType === "none")
        return 0;
    if (rule.commissionType === "fixed")
        return (0, settlementPeriods_1.round2)(rule.commissionValue);
    const orderTotal = typeof line.orderTotal === "number" && Number.isFinite(line.orderTotal) ? line.orderTotal : 0;
    const deliveryCost = typeof line.deliveryCost === "number" && Number.isFinite(line.deliveryCost) ? line.deliveryCost : 0;
    const base = rule.percentBase === "order_total" ? orderTotal : deliveryCost;
    return (0, settlementPeriods_1.round2)((base * rule.commissionValue) / 100);
}
