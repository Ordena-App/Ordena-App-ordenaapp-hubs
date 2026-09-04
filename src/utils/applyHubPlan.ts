import hubModel from "../models/hubModel";

export interface ApplyHubPlanParams {
    hubId: string;
    lookupKey: string;
    status?: string;
    periodStart?: string | Date | null;
    periodEnd?: string | Date | null;
    billingCycle?: "monthly" | "yearly";
    /** Documento de hub_plans ya resuelto por el caller (o null si no se encontró). */
    plan?: {
        code?: string;
        limits?: {
            businessesIncluded?: number;
            ordersPerMonth?: number;
            extraBusinessPrice?: number;
            extraOrderPrice?: number;
            businessesHardCap?: number;
        };
    } | null;
}

/**
 * ÚNICO camino de escritura de hub.subscription desde el ciclo de facturación.
 * Escribe planRef + estado/periodo, y vuelca los límites del plan como snapshot
 * (hub.subscription.limits). Fuente de verdad = hub_plans; el snapshot evita
 * un join en el camino caliente de cada pedido (incrementHubOrderUsage).
 *
 * Si el plan no se encontró (lookupKey sin documento en hub_plans), se
 * actualizan estado/periodo pero NO los límites: quedan los que había —
 * fail-open deliberado (default -1 = ilimitado) con log ruidoso, porque
 * bloquear la operación de N negocios por un catálogo desalineado sería peor.
 */
export async function applyPlanToHub(params: ApplyHubPlanParams): Promise<void> {
    const set: Record<string, unknown> = {
        "subscription.source": "STRIPE",
        "subscription.planRef.kind": "HUB_PLAN",
        "subscription.planRef.lookupKey": params.lookupKey,
        updated_at: new Date(),
    };
    if (params.status) set["subscription.status"] = params.status;
    if (params.billingCycle) set["subscription.billingCycle"] = params.billingCycle;
    if (params.periodStart) set["subscription.period.start"] = new Date(params.periodStart);
    if (params.periodEnd) set["subscription.period.end"] = new Date(params.periodEnd);

    if (params.plan) {
        if (params.plan.code) set["subscription.planRef.code"] = params.plan.code;
        const l = params.plan.limits || {};
        set["subscription.limits.businessesIncluded"] = l.businessesIncluded ?? -1;
        set["subscription.limits.ordersPerMonth"] = l.ordersPerMonth ?? -1;
        set["subscription.limits.extraBusinessPrice"] = l.extraBusinessPrice ?? 0;
        set["subscription.limits.extraOrderPrice"] = l.extraOrderPrice ?? 0;
        set["subscription.limits.businessesHardCap"] = l.businessesHardCap ?? -1;
    } else {
        console.error(
            "[applyPlanToHub] lookupKey '" + params.lookupKey + "' SIN documento en hub_plans: " +
            "se actualizo estado/periodo del hub " + params.hubId + " pero NO los limites. " +
            "Crear el plan en hub_plans (o corregir el lookup key en Stripe) y reaplicar."
        );
    }

    await hubModel.updateOne({ _id: params.hubId }, { $set: set });
}
