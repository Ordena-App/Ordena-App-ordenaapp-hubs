import hubModel from "../models/hubModel";
import hubUsageLedgerModel from "../models/hubUsageLedgerModel";
import { getHubOrdersSummary } from "./ordersService.external";

/**
 * Cierre de período (F3 v2 fase 2): re-cuenta los pedidos del período desde
 * orders-service y sella el ledger del hub. ESTE número es el que se factura;
 * usageMetrics queda solo como barra de uso del dashboard.
 *
 * Idempotente: si el ledger del período ya está INVOICED no se toca (el cobro
 * ya salió); mientras está DRAFT se puede re-sellar (un reintento del webhook
 * con datos más frescos gana).
 */
export async function sealLedgerForPeriod(
    hubId: string,
    periodStart: Date,
    periodEnd: Date
): Promise<Record<string, unknown> | null> {
    const period = `${periodEnd.getUTCFullYear()}-${String(periodEnd.getUTCMonth() + 1).padStart(2, "0")}`;

    const existing: any = await hubUsageLedgerModel.findOne({ hubId, period }).lean();
    if (existing && existing.status === "INVOICED") {
        return existing;
    }

    const hub: any = await hubModel.findById(hubId).select("subscription usageMetrics").lean();
    if (!hub) return null;

    // Los límites que aplican son los del snapshot vigente (lo que el hub tenía
    // contratado durante el período), no los del catálogo de hoy.
    const limits: any = hub.subscription?.limits || {};
    const ordersIncluded: number = limits.ordersPerMonth ?? -1;
    const businessesIncluded: number = limits.businessesIncluded ?? -1;
    const extraOrderPrice: number = limits.extraOrderPrice || 0;
    const extraBusinessPrice: number = limits.extraBusinessPrice || 0;

    // Re-conteo real (filtros espejo en orders: sin drafts/borrados/retenidos).
    const summaryResp = await getHubOrdersSummary(hubId, periodStart.toISOString(), periodEnd.toISOString());
    const ordersTotal: number = Number(summaryResp?.data?.totalOrders) || 0;

    const extraOrders = ordersIncluded === -1 ? 0 : Math.max(0, ordersTotal - ordersIncluded);
    const businessesCount: number = hub.usageMetrics?.businessesCount || 0;
    const extraBusinesses = businessesIncluded === -1 ? 0 : Math.max(0, businessesCount - businessesIncluded);

    const extraOrdersAmount = Math.round(extraOrders * extraOrderPrice * 100) / 100;
    const extraBusinessesAmount = Math.round(extraBusinesses * extraBusinessPrice * 100) / 100;
    const totalAmount = Math.round((extraOrdersAmount + extraBusinessesAmount) * 100) / 100;

    const now = new Date();
    const ledger = await hubUsageLedgerModel.findOneAndUpdate(
        { hubId, period, status: { $ne: "INVOICED" } },
        {
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
        },
        { upsert: true, new: true, setDefaultsOnInsert: true }
    ).lean();

    return ledger as any;
}
