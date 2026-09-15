import { Schema, model } from "mongoose";

/**
 * Liquidación del hub hacia UN repartidor por período (colección
 * hub_driver_settlements) — Sprint 5. Reemplaza el Excel del courier.
 *
 * Por cada entrega del período: qué cobró el repartidor al cliente (efectivo o
 * billetera) y cuánto gana por esa entrega (regla del hub o su override).
 *   driverEarnings = commissionAmount + adjustmentsTotal (bonos +, descuentos −)
 *   netToHub       = collectedTotal − driverEarnings
 *     > 0 → el repartidor le entrega ese dinero al hub
 *     < 0 → el hub le paga al repartidor
 * Ordena NO mueve el dinero: aquí solo queda el registro y el "Pagada".
 *
 * Las `lines` son un SNAPSHOT al generar (regenerable mientras no esté PAID; los
 * ajustes del PENDING se conservan al regenerar). Sin datos del cliente.
 */
const driverSettlementLineSchema = new Schema(
    {
        orderId: { type: String },
        orderNumber: { type: Number, default: null },
        businessId: { type: String },
        businessName: { type: String, default: null },
        deliveredAt: { type: Date },
        orderTotal: { type: Number, default: 0 },
        deliveryCost: { type: Number, default: 0 },
        distanceKm: { type: Number, default: null },
        paymentType: { type: String, default: null },
        collectedByDriver: { type: Boolean, default: false },
        collectedMethod: { type: String, default: null },
        collectedAmount: { type: Number, default: 0 },
        commissionAmount: { type: Number, default: 0 },
    },
    { _id: false }
);

const driverSettlementAdjustmentSchema = new Schema(
    {
        id: { type: String, required: true },
        concept: { type: String, required: true },
        // Positivo = a favor del repartidor (bono); negativo = descuento.
        amount: { type: Number, required: true },
        createdBy: { type: String, default: null },
        createdAt: { type: Date, default: Date.now },
    },
    { _id: false }
);

const hubDriverSettlementSchema = new Schema({
    hubId: { type: String, required: true },
    driverId: { type: String, required: true },
    // Snapshot del repartidor al generar (si cambia el nombre, la histórica no).
    driverName: { type: String, default: null },
    driverEmail: { type: String, default: null },

    // Clave del período (TZ del hub): YYYY-MM-DD · YYYY-Www · YYYY-MM-Q1|Q2 · YYYY-MM.
    period: { type: String, required: true },
    frequency: { type: String, enum: ["daily", "weekly", "biweekly", "monthly"], default: "daily" },
    periodStart: { type: Date, required: true },
    periodEnd: { type: Date, required: true },

    deliveriesCount: { type: Number, default: 0 },
    collectedTotal: { type: Number, default: 0 },
    deliveryFeesTotal: { type: Number, default: 0 },
    orderTotalsTotal: { type: Number, default: 0 },

    commissionType: { type: String, enum: ["fixed", "percent", "none"], default: "fixed" },
    commissionValue: { type: Number, default: 0 },
    percentBase: { type: String, enum: ["delivery_cost", "order_total"], default: "delivery_cost" },
    commissionAmount: { type: Number, default: 0 },

    adjustments: { type: [driverSettlementAdjustmentSchema], default: [] },
    adjustmentsTotal: { type: Number, default: 0 },
    driverEarnings: { type: Number, default: 0 },
    netToHub: { type: Number, default: 0 },
    currency: { type: String, default: "USD" },

    lines: { type: [driverSettlementLineSchema], default: [] },
    linesTruncated: { type: Boolean, default: false },

    status: { type: String, enum: ["PENDING", "PAID"], default: "PENDING" },
    paidAt: { type: Date, default: null },
    paidReference: { type: String, default: null },
    paidBy: { type: String, default: null },

    generatedAt: { type: Date },
    created_at: { type: Date, default: Date.now },
    updated_at: { type: Date, default: Date.now },
});

hubDriverSettlementSchema.index({ hubId: 1, driverId: 1, period: 1 }, { unique: true });
hubDriverSettlementSchema.index({ hubId: 1, period: 1 });
hubDriverSettlementSchema.index({ driverId: 1, period: 1 });

export default model("hub_driver_settlements", hubDriverSettlementSchema);
