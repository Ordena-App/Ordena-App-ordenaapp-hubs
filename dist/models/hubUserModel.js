"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const mongoose_1 = require("mongoose");
const hubUserSchema = new mongoose_1.Schema({
    hub_id: { type: mongoose_1.Schema.Types.ObjectId, ref: "hubs", required: true },
    name: { type: String },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    password: { type: String, required: true }, // bcrypt hash
    role: {
        type: String,
        enum: ["HUB_OWNER", "HUB_ADMIN", "HUB_STAFF", "BUSINESS_VIEWER", "DELIVERY_DRIVER"],
        default: "HUB_STAFF",
    },
    // Solo aplica (y es requerido) cuando role === 'BUSINESS_VIEWER'
    business_id: { type: String, default: null },
    // Teléfono de contacto (repartidores): para que el hub lo ubique. Opcional.
    phone: { type: String, default: null },
    // Permisos finos del BUSINESS_VIEWER (los concede/quita el hub desde Usuarios).
    permissions: {
        // Crear/editar/borrar productos y categorías de SU negocio desde el portal.
        manageCatalog: { type: Boolean, default: false },
    },
    status: { type: String, enum: ["ACTIVE", "SUSPENDED"], default: "ACTIVE" },
    password_reset_token_hash: { type: String, default: null },
    password_reset_expires_at: { type: Date, default: null },
    created_at: { type: Date, default: Date.now },
    updated_at: { type: Date, default: Date.now },
});
hubUserSchema.index({ hub_id: 1, role: 1 });
hubUserSchema.index({ hub_id: 1, business_id: 1 });
exports.default = (0, mongoose_1.model)("hub_users", hubUserSchema);
