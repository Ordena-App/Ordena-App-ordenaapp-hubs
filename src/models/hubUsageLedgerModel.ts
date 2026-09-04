import { Schema, model } from "mongoose";

/**
 * Ledger mensual de excedente por hub (colección hub_usage_ledgers) — F3 v2 fase 2.
 *
 * Sella lo FACTURABLE de un período de suscripción cerrado. La cifra sale de
 * RE-CONTAR la colección orders (summary interno de orders-service con los
 * filtros espejo: sin drafts, sin borrados, sin retenidos) — NUNCA del
 * contador usageMetrics, que es best-effort y puede perder pedidos.
 * Decisión de producto: pedido facturable = pedido CREADO.
 *
 * Idempotencia del cobro: índice único {hubId, period} + status. El webhook
 * de Stripe puede reintentar invoice.upcoming las veces que quiera: el claim
 * re-sella solo mientras está DRAFT, y el invoice item se crea una única vez
 * (queda stripeInvoiceItemId como testigo).
 */
const hubUsageLedgerSchema = new Schema({
    hubId: { type: String, required: true },
    // Clave humana del período (YYYY-MM del CIERRE del período de suscripción).
    period: { type: String, required: true },
    periodStart: { type: Date, required: true },
    periodEnd: { type: Date, required: true },

    // Pedidos (re-contados desde orders)
    ordersTotal: { type: Number, default: 0 },
    ordersIncluded: { type: Number, default: -1 },
    extraOrders: { type: Number, default: 0 },
    extraOrderPrice: { type: Number, default: 0 },
    extraOrdersAmount: { type: Number, default: 0 },

    // Negocios extra (decisión: al ledger mensual, no subscription item)
    businessesCount: { type: Number, default: 0 },
    businessesIncluded: { type: Number, default: -1 },
    extraBusinesses: { type: Number, default: 0 },
    extraBusinessPrice: { type: Number, default: 0 },
    extraBusinessesAmount: { type: Number, default: 0 },

    totalAmount: { type: Number, default: 0 },
    currency: { type: String, default: "USD" },

    status: { type: String, enum: ["DRAFT", "INVOICED"], default: "DRAFT" },
    stripeInvoiceItemId: { type: String, default: null },

    computedAt: { type: Date },
    invoicedAt: { type: Date },
    created_at: { type: Date, default: Date.now },
    updated_at: { type: Date, default: Date.now },
});

hubUsageLedgerSchema.index({ hubId: 1, period: 1 }, { unique: true });

export default model("hub_usage_ledgers", hubUsageLedgerSchema);
