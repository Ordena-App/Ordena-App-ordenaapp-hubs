import { Schema, model } from "mongoose";

/**
 * Catálogo de planes de hub (colección hub_plans) — F3 v2.
 *
 * FUENTE DE VERDAD de los límites comerciales: el código no quema límites,
 * los lee de aquí. `hub.subscription.limits` es solo un snapshot desnormalizado
 * que reescribe applyPlanToHub cuando el webhook de Stripe cambia el plan.
 *
 * Colección propia (NO la `plans` de business): los planes CORE tienen un enum
 * cerrado de códigos y límites por negocio; los de hub tienen límites que un
 * negocio no tiene (businessesIncluded) y códigos negociables por cliente.
 *
 * Un plan NEGOCIADO para un hub concreto es solo un documento más con
 * isPublic: false + su price en Stripe — cero deploys.
 *
 * Convención de límites: -1 = ilimitado, 0 = bloqueado (misma que planFeatures).
 */
const hubPlanSchema = new Schema({
    // Identificador estable del plan (HUB_PILOTO, HUB_STANDARD, HUB_ACME…)
    code: { type: String, required: true, unique: true, uppercase: true, trim: true },
    name: { type: String, required: true },
    description: { type: String },

    // Precio de exhibición (el cobro real vive en Stripe; esto pinta la UI)
    price: { type: Number, required: true },
    currency: { type: String, default: "USD" },
    billingCycle: { type: String, enum: ["monthly", "yearly"], default: "monthly" },

    // TODOS los lookup keys de Stripe que resuelven a este plan. Un plan puede
    // tener varios precios (ej. hub_piloto_monthly_v1 a $149 y _v2 a $199 para
    // el cambio programado por Subscription Schedule): mismo plan, mismos
    // límites, distinto precio. Únicos globalmente (índice multikey unique).
    lookupKeys: { type: [String], default: [] },

    limits: {
        businessesIncluded: { type: Number, default: -1 },
        ordersPerMonth: { type: Number, default: -1 },
        extraBusinessPrice: { type: Number, default: 0 },
        extraOrderPrice: { type: Number, default: 0 },
        // Freno de emergencia: por encima de businessesIncluded se permite y se
        // factura como extra (sin bloquear la operación); por encima del hard
        // cap sí se bloquea. -1 = sin freno.
        businessesHardCap: { type: Number, default: -1 },
    },

    // ¿Aparece en la vitrina pública de planes? Los negociados van en false.
    isPublic: { type: Boolean, default: false },
    is_active: { type: Boolean, default: true },

    created_at: { type: Date, default: Date.now },
    updated_at: { type: Date, default: Date.now },
});

hubPlanSchema.index({ lookupKeys: 1 }, { unique: true, sparse: true });

export default model("hub_plans", hubPlanSchema);
