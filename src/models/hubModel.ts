import { Schema, model, Document, Types } from "mongoose";

// ---- Branding del Hub (la experiencia pública pertenece al operador) ----
const brandingSchema = new Schema(
    {
        primaryColor: { type: String },
        primaryForeground: { type: String },
        secondaryColor: { type: String },
        gradientFrom: { type: String },
        gradientTo: { type: String },
        bannerUrl: { type: String },
        // Toggle del banner en el hero del storefront (ausente = mostrar)
        bannerEnabled: { type: Boolean },
        // Negocios por fila en el storefront movil: 1 (tarjeta ancha, default)
        // o 2 (mitad y mitad). En pantallas grandes la grilla no cambia.
        businessesMobileColumns: { type: Number },
    },
    { _id: false }
);

const contactSchema = new Schema(
    {
        email: { type: String },
        phone: { type: String },
        // Número que recibe la notificación general de cada pedido del hub
        // (adicional a la notificación que recibe el negocio correspondiente).
        whatsapp: { type: String },
        // Repartidor del hub (F3): el operador hace el delivery de TODOS sus
        // negocios, así que el número vive aquí y no se repite por negocio.
        // Recibe el aviso al pulsar "Notificar a repartidor" en un pedido.
        deliveryWhatsapp: { type: String },
        website: { type: String },
        instagram: { type: String },
        facebook: { type: String },
        tiktok: { type: String },
    },
    { _id: false }
);

// ---- Dominio custom (F4; el schema queda listo desde F1) ----
const domainSchema = new Schema(
    {
        requestedDomain: { type: String },
        verifiedDomain: { type: String },
        sslEnabled: { type: Boolean, default: false },
        status: {
            type: String,
            enum: ["unconfigured", "pending", "verified", "error"],
            default: "unconfigured",
        },
    },
    { _id: false }
);

// ---- Suscripción del Hub (F3: Stripe directo, como CORE) ----
// El Hub es el cliente de Ordena: una sola suscripción cubre todos sus
// negocios. Los negocios HUB_MANAGED no pagan individualmente.
const subscriptionSchema = new Schema(
    {
        source: { type: String, enum: ["STRIPE", "MANUAL"], default: "STRIPE" },
        status: {
            type: String,
            enum: ["ACTIVE", "CANCELLED", "EXPIRED", "PAUSED", "PAST_DUE", "CANCELED", "INACTIVE", "TRIAL"],
            default: "TRIAL",
        },
        planRef: {
            kind: { type: String, enum: ["HUB_PLAN"], default: "HUB_PLAN" },
            lookupKey: { type: String },
            code: { type: String },
        },
        period: {
            start: { type: Date },
            end: { type: Date },
        },
        billingCycle: { type: String, enum: ["monthly", "yearly"], default: "monthly" },
        // Desde cuándo está en mora (lo escribe el PATCH interno de billing).
        // A los 15 días de mora se bloquea crear negocios/usuarios — NUNCA la
        // operación pública (decisión F3 v2). null = al día.
        pastDueSince: { type: Date, default: null },
        // Límites comerciales del plan. Defaults PERMISIVOS (-1 = ilimitado),
        // misma convención de red de seguridad que planFeatures en business.
        limits: {
            businessesIncluded: { type: Number, default: -1 },
            ordersPerMonth: { type: Number, default: -1 },
            extraBusinessPrice: { type: Number, default: 0 },
            extraOrderPrice: { type: Number, default: 0 },
            // Freno de emergencia (F3 v2): sobre businessesIncluded se factura
            // como extra sin bloquear; sobre el hard cap si se bloquea. -1 = sin freno.
            businessesHardCap: { type: Number, default: -1 },
        },
    },
    { _id: false }
);

const hubSchema = new Schema({
    name: { type: String, required: true },
    // Slug público: {slug}.ordena.app. Único global. Se valida contra la
    // lista de reservados y disponibilidad en el onboarding.
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true },
    description: { type: String },
    logo: { type: String },
    favicon: { type: String },

    branding: { type: brandingSchema, default: () => ({}) },
    contact: { type: contactSchema, default: () => ({}) },
    domain: { type: domainSchema, default: () => ({}) },

    // Zona horaria del hub: cálculos de apertura, estadísticas y rotación de
    // métricas la respetan. Cada Business mantiene además su propio horario.
    timezone: { type: String, default: "America/El_Salvador" },
    country: { type: String, required: true },
    currency: { type: String, required: true },
    language: { type: String, enum: ["ES", "EN"], default: "ES" },

    status: {
        type: String,
        enum: ["ACTIVE", "SUSPENDED", "INACTIVE"],
        default: "ACTIVE",
    },

    subscription: { type: subscriptionSchema, default: () => ({}) },

    // ---- Métricas de uso (límites del plan; rotación mensual idéntica al
    // patrón usageMetrics de business) ----
    usageMetrics: {
        businessesCount: { type: Number, default: 0 },
        ordersCurrentMonth: { type: Number, default: 0 },
        ordersPreviousMonth: { type: Number, default: 0 },
        extraOrdersCurrentMonth: { type: Number, default: 0 },
        lastRotatedAt: { type: Date },
        // Reclamo atómico del aviso del 80% (una vez por mes): YYYY-MM ya avisado.
        nudge80MonthKey: { type: String, default: null },
    },

    // ---- Liquidaciones (F4): comision del hub hacia sus negocios ----
    // Default del hub + overrides POR NEGOCIO (a unos les cobra mas y a otros
    // menos — decision de producto). percent = % sobre ventas brutas;
    // fixed = monto fijo por pedido; none = sin comision.
    settlementConfig: {
        commissionType: { type: String, enum: ["percent", "fixed", "none"], default: "percent" },
        commissionValue: { type: Number, default: 0 },
    },
    commissionOverrides: {
        type: [
            new Schema(
                {
                    businessId: { type: String, required: true },
                    commissionType: { type: String, enum: ["percent", "fixed", "none"], default: "percent" },
                    commissionValue: { type: Number, default: 0 },
                },
                { _id: false }
            ),
        ],
        default: [],
    },

    // ---- Visibilidad hacia los Businesses (F4: configurable por hub) ----
    // Qué información del cliente final puede ver cada Business en su portal.
    businessVisibility: {
        customerName: { type: Boolean, default: true },
        customerPhone: { type: Boolean, default: false },
        customerAddress: { type: Boolean, default: false },
    },

    isTestHub: { type: Boolean, default: false },

    created_at: { type: Date, default: Date.now },
    updated_at: { type: Date, default: Date.now },
});

export interface IHub extends Document {
    _id: Types.ObjectId;
    name: string;
    slug: string;
    description?: string;
    logo?: string;
    favicon?: string;
    branding: {
        primaryColor?: string;
        primaryForeground?: string;
        secondaryColor?: string;
        gradientFrom?: string;
        gradientTo?: string;
        bannerUrl?: string;
        bannerEnabled?: boolean;
        businessesMobileColumns?: number;
    };
    contact: {
        email?: string;
        phone?: string;
        whatsapp?: string;
        deliveryWhatsapp?: string;
        website?: string;
        instagram?: string;
        facebook?: string;
        tiktok?: string;
    };
    domain: {
        requestedDomain?: string;
        verifiedDomain?: string;
        sslEnabled: boolean;
        status: "unconfigured" | "pending" | "verified" | "error";
    };
    timezone: string;
    country: string;
    currency: string;
    language: "ES" | "EN";
    status: "ACTIVE" | "SUSPENDED" | "INACTIVE";
    subscription: {
        source: "STRIPE" | "MANUAL";
        status: string;
        planRef: { kind: "HUB_PLAN"; lookupKey?: string; code?: string };
        period: { start?: Date; end?: Date };
        billingCycle: "monthly" | "yearly";
        limits: {
            businessesIncluded: number;
            ordersPerMonth: number;
            extraBusinessPrice: number;
            extraOrderPrice: number;
        };
    };
    usageMetrics: {
        businessesCount: number;
        ordersCurrentMonth: number;
        ordersPreviousMonth: number;
        extraOrdersCurrentMonth: number;
        lastRotatedAt?: Date;
    };
    businessVisibility: {
        customerName: boolean;
        customerPhone: boolean;
        customerAddress: boolean;
    };
    isTestHub: boolean;
    created_at: Date;
    updated_at: Date;
}

export default model<IHub>("hubs", hubSchema);
