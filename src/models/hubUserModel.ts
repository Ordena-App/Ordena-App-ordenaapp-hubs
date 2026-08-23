import { Schema, model, Document, Types } from "mongoose";

// Roles del ecosistema Hub:
// - HUB_OWNER: control total del hub (billing incluido).
// - HUB_ADMIN: administra negocios, pedidos, categorías y usuarios.
// - HUB_STAFF: operativa (pedidos) sin administración.
// - BUSINESS_VIEWER: login del Portal Business. SOLO ve/opera la información
//   de SU businessId (fijado en el documento y estampado en el JWT). Nunca
//   accede a datos de otros negocios ni a información financiera del hub.
export type HubUserRole = "HUB_OWNER" | "HUB_ADMIN" | "HUB_STAFF" | "BUSINESS_VIEWER";

const hubUserSchema = new Schema({
    hub_id: { type: Schema.Types.ObjectId, ref: "hubs", required: true },
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

export interface IHubUser extends Document {
    _id: Types.ObjectId;
    hub_id: Types.ObjectId;
    name?: string;
    email: string;
    password: string;
    role: HubUserRole;
    business_id?: string | null;
    status: "ACTIVE" | "SUSPENDED";
    password_reset_token_hash?: string | null;
    password_reset_expires_at?: Date | null;
    created_at: Date;
    updated_at: Date;
}

export default model<IHubUser>("hub_users", hubUserSchema);
