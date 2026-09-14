import { round2, SettlementFrequency } from "./settlementPeriods";

// ════════════════════════════════════════════════════════════════════════════
// Sprint 5 — Lo que el hub le paga al repartidor por cada entrega.
//
// Regla resuelta = override del repartidor (hub.driverCommissionOverrides) si
// existe; si no, el default del hub (hub.driverPayConfig). Hubs anteriores a
// este sprint (sin driverPayConfig) se comportan como 'fixed' 0 = sin comisión,
// con corte diario: defaults conservadores, nada cambia hasta que el hub lo
// configure.
// ════════════════════════════════════════════════════════════════════════════

export type DriverCommissionType = "fixed" | "percent" | "none";
export type DriverPercentBase = "delivery_cost" | "order_total";

export const DRIVER_COMMISSION_TYPES: DriverCommissionType[] = ["fixed", "percent", "none"];
export const DRIVER_PERCENT_BASES: DriverPercentBase[] = ["delivery_cost", "order_total"];

export interface DriverPayRule {
    commissionType: DriverCommissionType;
    commissionValue: number;
    percentBase: DriverPercentBase;
}

export interface DriverPayConfigResolved extends DriverPayRule {
    frequency: SettlementFrequency;
}

/** Línea mínima que necesita el cálculo (subset de las líneas que devuelve orders). */
export interface DriverPayLine {
    orderTotal?: number | null;
    deliveryCost?: number | null;
}

function sanitizeRule(raw: any, fallback: DriverPayRule): DriverPayRule {
    const commissionType = DRIVER_COMMISSION_TYPES.includes(raw?.commissionType) ? (raw.commissionType as DriverCommissionType) : fallback.commissionType;
    const commissionValue =
        typeof raw?.commissionValue === "number" && Number.isFinite(raw.commissionValue) && raw.commissionValue >= 0
            ? raw.commissionValue
            : fallback.commissionValue;
    const percentBase = DRIVER_PERCENT_BASES.includes(raw?.percentBase) ? (raw.percentBase as DriverPercentBase) : fallback.percentBase;
    return { commissionType, commissionValue, percentBase };
}

const DEFAULT_RULE: DriverPayRule = { commissionType: "fixed", commissionValue: 0, percentBase: "delivery_cost" };

/** driverPayConfig del hub saneado (defaults: fixed 0, base delivery_cost, corte diario). */
export function resolveDriverPayConfig(hub: any): DriverPayConfigResolved {
    const cfg = hub?.driverPayConfig || {};
    const rule = sanitizeRule(cfg, DEFAULT_RULE);
    const frequency: SettlementFrequency = ["daily", "weekly", "biweekly", "monthly"].includes(cfg?.frequency) ? cfg.frequency : "daily";
    return { ...rule, frequency };
}

/** Regla efectiva para UN repartidor: su override si existe, si no el default del hub. */
export function resolveDriverPayRule(hub: any, driverId: string): DriverPayRule {
    const base = resolveDriverPayConfig(hub);
    const override = (Array.isArray(hub?.driverCommissionOverrides) ? hub.driverCommissionOverrides : []).find(
        (o: any) => String(o?.driverId) === String(driverId)
    );
    if (!override) return { commissionType: base.commissionType, commissionValue: base.commissionValue, percentBase: base.percentBase };
    // El override es una regla completa: lo que no traiga válido cae al default del hub.
    return sanitizeRule(override, base);
}

/**
 * Comisión de UNA entrega según la regla resuelta:
 *   fixed   → commissionValue por entrega
 *   percent → (percentBase === 'order_total' ? total del pedido : costo de envío) × commissionValue / 100
 *   none    → 0
 */
export function computeDriverCommission(rule: DriverPayRule, line: DriverPayLine): number {
    if (rule.commissionType === "none") return 0;
    if (rule.commissionType === "fixed") return round2(rule.commissionValue);
    const orderTotal = typeof line.orderTotal === "number" && Number.isFinite(line.orderTotal) ? line.orderTotal : 0;
    const deliveryCost = typeof line.deliveryCost === "number" && Number.isFinite(line.deliveryCost) ? line.deliveryCost : 0;
    const base = rule.percentBase === "order_total" ? orderTotal : deliveryCost;
    return round2((base * rule.commissionValue) / 100);
}
