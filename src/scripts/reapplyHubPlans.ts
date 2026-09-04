/**
 * Re-aplica los límites del catálogo hub_plans al snapshot de los hubs YA
 * suscritos (hub.subscription.limits).
 *   npx ts-node src/scripts/reapplyHubPlans.ts
 *
 * Cuándo usarlo: después de editar un plan (seedHubPlans o Mongo a mano) —
 * el snapshot desnormalizado de cada hub NO se actualiza solo hasta el
 * siguiente evento de facturación de Stripe.
 *
 * Toca SOLO subscription.limits.* (+ planRef.code si faltaba): no pisa
 * source/status/periodo/lookupKey, así que es seguro sobre suscripciones
 * manuales (Oe Ya) y hubs en trial por igual.
 */
import mongoose from "mongoose";
import { DB_LINK } from "../config/config";
import hubModel from "../models/hubModel";
import hubPlanModel from "../models/hubPlanModel";

async function run(): Promise<void> {
    await mongoose.connect(DB_LINK);

    const plans = await hubPlanModel.find({ is_active: true });
    const byLookup = new Map<string, any>();
    const byCode = new Map<string, any>();
    for (const p of plans) {
        byCode.set(p.code, p);
        for (const lk of p.lookupKeys || []) byLookup.set(lk, p);
    }

    const hubs = await hubModel.find({ "subscription.planRef.kind": "HUB_PLAN" });
    let updated = 0;
    for (const hub of hubs) {
        const ref: any = hub.subscription?.planRef || {};
        const plan = (ref.lookupKey && byLookup.get(ref.lookupKey)) || (ref.code && byCode.get(ref.code)) || null;
        if (!plan) {
            console.warn(
                `[reapplyHubPlans] hub ${hub._id} (${hub.slug}) sin plan resoluble ` +
                `(lookupKey='${ref.lookupKey || ""}', code='${ref.code || ""}') — se deja como está.`
            );
            continue;
        }
        const l: any = plan.limits || {};
        await hubModel.updateOne(
            { _id: hub._id },
            {
                $set: {
                    "subscription.planRef.code": plan.code,
                    "subscription.limits.businessesIncluded": l.businessesIncluded ?? -1,
                    "subscription.limits.ordersPerMonth": l.ordersPerMonth ?? -1,
                    "subscription.limits.extraBusinessPrice": l.extraBusinessPrice ?? 0,
                    "subscription.limits.extraOrderPrice": l.extraOrderPrice ?? 0,
                    "subscription.limits.businessesHardCap": l.businessesHardCap ?? -1,
                    updated_at: new Date(),
                },
            }
        );
        updated++;
        console.log(
            `[reapplyHubPlans] hub ${hub.slug}: ${plan.code} → ` +
            `${l.businessesIncluded} negocios / ${l.ordersPerMonth} pedidos / ` +
            `$${l.extraBusinessPrice} negocio extra / $${l.extraOrderPrice} pedido extra`
        );
    }

    console.log(`[reapplyHubPlans] ${updated}/${hubs.length} hubs re-aplicados.`);
    await mongoose.disconnect();
}

run().catch((e) => {
    console.error("[reapplyHubPlans] error:", e);
    process.exit(1);
});
