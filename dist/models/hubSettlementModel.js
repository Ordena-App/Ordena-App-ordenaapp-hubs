"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const mongoose_1 = require("mongoose");
/**
 * Liquidación mensual del hub hacia UN negocio (colección hub_settlements) — F4.
 *
 * El hub cobra centralizado; esto documenta cuánto le debe a cada negocio por
 * el período: ventas brutas (pedidos ENTREGADOS y PAGADOS, re-contados desde
 * orders), comisión del hub y neto a pagar. Ordena NO mueve el dinero: el hub
 * transfiere por fuera (su banco) y aquí solo marca "Pagado" con referencia.
 *
 * Las `lines` son un SNAPSHOT congelado al generar: un pedido que cambie de
 * estado después NO reescribe una liquidación — el ajuste entra al período
 * siguiente. Regenerar solo es posible mientras el status no sea PAID.
 * Las líneas NO llevan datos del cliente (una liquidación no los necesita).
 */
const settlementLineSchema = new mongoose_1.Schema({
    orderId: { type: String },
    date: { type: Date },
    total: { type: Number },
    paymentType: { type: String },
}, { _id: false });
const hubSettlementSchema = new mongoose_1.Schema({
    hubId: { type: String, required: true },
    businessId: { type: String, required: true },
    // Snapshot del nombre (si el negocio se renombra, la liquidación histórica
    // sigue diciendo lo que decía cuando se emitió).
    businessName: { type: String },
    period: { type: String, required: true }, // YYYY-MM (mes calendario en la TZ del hub)
    periodStart: { type: Date, required: true },
    periodEnd: { type: Date, required: true },
    ordersCount: { type: Number, default: 0 },
    grossSales: { type: Number, default: 0 },
    commissionType: { type: String, enum: ["percent", "fixed", "none"], default: "percent" },
    commissionValue: { type: Number, default: 0 },
    commissionAmount: { type: Number, default: 0 },
    netPayable: { type: Number, default: 0 },
    currency: { type: String, default: "USD" },
    lines: { type: [settlementLineSchema], default: [] },
    linesTruncated: { type: Boolean, default: false },
    status: { type: String, enum: ["PENDING", "PAID"], default: "PENDING" },
    paidAt: { type: Date, default: null },
    paidReference: { type: String, default: null },
    generatedAt: { type: Date },
    created_at: { type: Date, default: Date.now },
    updated_at: { type: Date, default: Date.now },
});
hubSettlementSchema.index({ hubId: 1, businessId: 1, period: 1 }, { unique: true });
hubSettlementSchema.index({ hubId: 1, period: 1 });
exports.default = (0, mongoose_1.model)("hub_settlements", hubSettlementSchema);
