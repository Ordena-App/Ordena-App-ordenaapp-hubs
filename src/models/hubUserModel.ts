import { Schema, model, Document, Types } from "mongoose";

// Roles del ecosistema Hub:
// - HUB_OWNER: control total del hub (billing incluido).
// - HUB_ADMIN: administra negocios, pedidos, categorías y usuarios.
// - HUB_STAFF: operativa (pedidos) sin administración.
// - BUSINESS_VIEWER: login del Portal Business. SOLO ve/opera la información
//   de SU businessId (fijado en el documento y estampado en el JWT). Nunca
//   accede a datos de otros negocios ni a información financiera del hub.
// - DELIVERY_DRIVER: repartidor del hub (Sprint 3). Entra a la app /hub-driver con
//   email y contraseña: ve la bolsa de pedidos publicados, toma pedidos y avanza
//   los estados de entrega de LOS SUYOS. Del cliente solo ve lo que el hub
//   decide (driverVisibility); dirección, referencia y pin siempre.
export type HubUserRole = "HUB_OWNER" | "HUB_ADMIN" | "HUB_STAFF" | "BUSINESS_VIEWER" | "DELIVERY_DRIVER";

const hubUserSchema = new Schema({
    hub_id: { type: Schema.Types.ObjectId, ref: "hubs", required: true },
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

export interface IHubUser extends Document {
    _id: Types.ObjectId;
    hub_id: Types.ObjectId;
    name?: string;
    email: string;
    password: string;
    role: HubUserRole;
    business_id?: string | null;
    phone?: string | null;
    permissions?: { manageCatalog?: boolean };
    status: "ACTIVE" | "SUSPENDED";
    password_reset_token_hash?: string | null;
    password_reset_expires_at?: Date | null;
    created_at: Date;
    updated_at: Date;
}

export default model<IHubUser>("hub_users", hubUserSchema);
