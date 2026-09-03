/**
 * Semilla idempotente del catálogo hub_plans (upsert por code).
 *   npx ts-node src/scripts/seedHubPlans.ts
 *
 * Los montos/límites son EDITABLES EN MONGO sin deploy — este seed solo
 * garantiza que los documentos existan. Cambiar un plan del catálogo NO
 * re-aplica los snapshots de hubs existentes (usar applyPlanToHub para eso).
 *
 * HUB_PILOTO (Oe Ya — precio preferente por proponer el modelo, isPublic false):
 *   trial 7 días → $149 → $199 tras 6 ciclos. Las DOS fases del Subscription
 *   Schedule usan lookup keys de ESTE plan (v1/v2): mismo plan y límites,
 *   solo cambia el precio — el webhook no necesita lógica especial en el mes 6.
 */
import mongoose from "mongoose";
import { DB_LINK } from "../config/config";
import hubPlanModel from "../models/hubPlanModel";

const PLANS = [
    {
        code: "HUB_PILOTO",
        name: "Plan Piloto",
        description: "Plan preferente del hub piloto (Oe Ya). No aparece en la vitrina pública.",
        price: 149,
        currency: "USD",
        billingCycle: "monthly",
        lookupKeys: ["hub_piloto_monthly_v1", "hub_piloto_monthly_v2"],
        limits: {
            // Alineado a la operacion real de Oe Ya (~20 negocios, ~1,800
            // pedidos/mes): el crecimiento por encima se factura como
            // excedente en vez de regalarse dentro del incluido.
            businessesIncluded: 20,
            ordersPerMonth: 1800,
            extraBusinessPrice: 5,
            extraOrderPrice: 0.05,
            businessesHardCap: 100,
        },
        isPublic: false,
        is_active: true,
    },
    {
        code: "HUB_STANDARD",
        name: "Plan Hub",
        description: "Plan estándar para operadores multi-negocio.",
        price: 199,
        currency: "USD",
        billingCycle: "monthly",
        lookupKeys: ["hub_standard_monthly_v1"],
        limits: {
            businessesIncluded: 20,
            ordersPerMonth: 2000,
            extraBusinessPrice: 8,
            extraOrderPrice: 0.08,
            businessesHardCap: 100,
        },
        isPublic: true,
        is_active: true,
    },
];

async function run(): Promise<void> {
    await mongoose.connect(DB_LINK);
    for (const plan of PLANS) {
        const res = await hubPlanModel.updateOne(
            { code: plan.code },
            { $set: { ...plan, updated_at: new Date() }, $setOnInsert: { created_at: new Date() } },
            { upsert: true }
        );
        console.log(`[seedHubPlans] ${plan.code}: ${res.upsertedCount ? "creado" : "actualizado"}`);
    }
    await mongoose.disconnect();
}

run().catch((e) => {
    console.error("[seedHubPlans] error:", e);
    process.exit(1);
});
