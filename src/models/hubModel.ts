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

    // ---- Ubicación de entrega por defecto (prefill del checkout) ----
    // Un hub suele operar en UNA sola ciudad (ej. Trujillo): estos valores se
    // propagan a delivery_options.default_delivery_location de todos sus
    // negocios HUB_MANAGED para que el checkout manual pre-rellene
    // Departamento/Estado y Ciudad. Siempre editable por el cliente final.
    deliveryDefaults: {
        state: { type: String, default: null },
        // ISO 3166-2 del estado (ej. "HN-CL"); match exacto en el checkout y
        // en el matcher de zonas sin depender de acentos del nombre.
        stateIso: { type: String, default: null },
        city: { type: String, default: null },
    },

    // ---- Métodos de entrega del checkout (fulfillment) ----
    // El hub decide qué ofrecen TODOS sus negocios en el checkout: delivery
    // propio (el operador reparte), recogida en local, y la tarifa plana del
    // delivery. Se propaga a delivery_options de los negocios HUB_MANAGED
    // (own_delivery / onSite / delivery), que no tienen dashboard propio.
    fulfillment: {
        deliveryEnabled: { type: Boolean, default: true },
        pickupEnabled: { type: Boolean, default: true },
        deliveryFee: { type: Number, default: 0 },
        // Cómo se cobra el delivery en TODOS los negocios del hub:
        //   'flat'     → deliveryFee plano (default).
        //   'distance' → base + precio/km desde la ubicación de cada negocio
        //                hasta el pin del cliente (ruta real con fallback).
        pricingMode: { type: String, enum: ["flat", "distance"], default: "flat" },
        // Efectivo contra entrega en el checkout de todos los negocios
        // (se propaga a payment_methods.cash; la pantalla de pago lo exige).
        cashOnDelivery: { type: Boolean, default: true },
        // Si cada negocio puede fijar su tiempo estimado de entrega desde su
        // portal. Apagado = lo pone el hub por negocio (Negocios → Información).
        businessesEditEta: { type: Boolean, default: false },
        distance: {
            base_fee: { type: Number, default: 0 },
            included_km: { type: Number, default: 0 },
            price_per_km: { type: Number, default: 0 },
            max_distance_km: { type: Number, default: null },
        },
    },

    // Comprobante de pago en métodos manuales (Yape, transferencia…) de TODOS
    // sus negocios: si la pantalla de pago pide adjuntarlo y a quién va el aviso
    // de WhatsApp después ('hub' = número del hub, 'business' = el del negocio,
    // 'none' = sin aviso). Se propaga a payment_proof de cada negocio.
    paymentFlow: {
        requireProof: { type: Boolean, default: true },
        notifyTarget: { type: String, enum: ["hub", "business", "none"], default: "hub" },
    },

    // ---- Flujo del pedido (Sprint 3) ----
    // hubConfirms: el hub confirma cada pedido ANTES de que el negocio lo vea y
    // reciba su WhatsApp (apagado = flujo directo, como SaaS/WL).
    // autoPublishOnConfirm: al confirmar, el pedido de delivery entra solo a la
    // bolsa de repartidores (el hub puede desmarcarlo pedido a pedido).
    // notifyCustomerOnConfirm (Sprint 4): aviso al cliente por WhatsApp con el
    // tiempo estimado del negocio al confirmar el pedido (plantilla
    // pedido_confirmado_cliente_es). Se propaga a orders vía notification-config.
    // Costo por mensaje de Meta considerado en el plan; default encendido.
    orderFlow: {
        hubConfirms: { type: Boolean, default: false },
        autoPublishOnConfirm: { type: Boolean, default: true },
        notifyCustomerOnConfirm: { type: Boolean, default: true },
    },
    // Qué datos del cliente ve el REPARTIDOR en su app. Dirección, referencia y
    // pin van siempre (los necesita para entregar); el teléfono va apagado por
    // defecto: el repartidor navega al pin exacto sin llamar al cliente.
    driverVisibility: {
        customerName: { type: Boolean, default: true },
        customerPhone: { type: Boolean, default: false },
    },

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
        // Frecuencia de corte de las liquidaciones. Define el formato del período:
        // daily YYYY-MM-DD · weekly YYYY-Www (lunes a domingo) · biweekly YYYY-MM-Q1|Q2
        // (1–15 y 16–fin de mes) · monthly YYYY-MM. Cambiarla no toca lo ya generado.
        frequency: { type: String, enum: ["daily", "weekly", "biweekly", "monthly"], default: "monthly" },
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

    // ---- Liquidación de repartidores (Sprint 5): lo que el hub paga por entrega ----
    // fixed = monto fijo por entrega; percent = % del costo de envío o del total
    // del pedido (percentBase); none = sin comisión. La frecuencia define el corte
    // de las liquidaciones de repartidores (independiente de la de negocios).
    // Hubs sin esta config se comportan como fixed 0 (sin comisión) y corte diario.
    driverPayConfig: {
        commissionType: { type: String, enum: ["fixed", "percent", "none"], default: "fixed" },
        commissionValue: { type: Number, default: 0 },
        percentBase: { type: String, enum: ["delivery_cost", "order_total"], default: "delivery_cost" },
        frequency: { type: String, enum: ["daily", "weekly", "biweekly", "monthly"], default: "daily" },
    },
    // Excepciones POR REPARTIDOR (a unos les paga distinto). driverId = _id de hub_users.
    driverCommissionOverrides: {
        type: [
            new Schema(
                {
                    driverId: { type: String, required: true },
                    commissionType: { type: String, enum: ["fixed", "percent", "none"], default: "fixed" },
                    commissionValue: { type: Number, default: 0 },
                    percentBase: { type: String, enum: ["delivery_cost", "order_total"], default: "delivery_cost" },
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
    /** Prefill de estado/ciudad para el checkout de sus negocios. */
    deliveryDefaults?: {
        state?: string | null;
        stateIso?: string | null;
        city?: string | null;
    };
    /** Métodos de entrega del checkout de sus negocios + tarifa plana de delivery. */
    paymentFlow?: { requireProof?: boolean; notifyTarget?: "hub" | "business" | "none" };
    /** Flujo del pedido: confirmación del hub, publicación automática en la bolsa y aviso al cliente al confirmar. */
    orderFlow?: { hubConfirms?: boolean; autoPublishOnConfirm?: boolean; notifyCustomerOnConfirm?: boolean };
    /** Qué datos del cliente ve el repartidor (dirección, referencia y pin siempre). */
    driverVisibility?: { customerName?: boolean; customerPhone?: boolean };
    fulfillment?: {
        deliveryEnabled?: boolean;
        pickupEnabled?: boolean;
        deliveryFee?: number;
        pricingMode?: "flat" | "distance";
        cashOnDelivery?: boolean;
        businessesEditEta?: boolean;
        distance?: {
            base_fee?: number;
            included_km?: number;
            price_per_km?: number;
            max_distance_km?: number | null;
        };
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
    /** Sprint 5: comisión del hub hacia sus repartidores y frecuencia de corte. */
    driverPayConfig?: {
        commissionType?: "fixed" | "percent" | "none";
        commissionValue?: number;
        percentBase?: "delivery_cost" | "order_total";
        frequency?: "daily" | "weekly" | "biweekly" | "monthly";
    };
    driverCommissionOverrides?: Array<{
        driverId: string;
        commissionType?: "fixed" | "percent" | "none";
        commissionValue?: number;
        percentBase?: "delivery_cost" | "order_total";
    }>;
    isTestHub: boolean;
    created_at: Date;
    updated_at: Date;
}

export default model<IHub>("hubs", hubSchema);
