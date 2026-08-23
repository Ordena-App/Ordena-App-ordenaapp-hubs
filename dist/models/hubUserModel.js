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
        enum: ["HUB_OWNER", "HUB_ADMIN", "HUB_STAFF", "BUSINESS_VIEWER"],
        default: "HUB_STAFF",
    },
    // Solo aplica (y es requerido) cuando role === 'BUSINESS_VIEWER'
    business_id: { type: String, default: null },
    status: { type: String, enum: ["ACTIVE", "SUSPENDED"], default: "ACTIVE" },
    password_reset_token_hash: { type: String, default: null },
    password_reset_expires_at: { type: Date, default: null },
    created_at: { type: Date, default: Date.now },
    updated_at: { type: Date, default: Date.now },
});
hubUserSchema.index({ hub_id: 1, role: 1 });
hubUserSchema.index({ hub_id: 1, business_id: 1 });
exports.default = (0, mongoose_1.model)("hub_users", hubUserSchema);
