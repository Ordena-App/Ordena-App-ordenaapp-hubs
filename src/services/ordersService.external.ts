import axios from "axios";
import { ORDERS_SERVICE_LINK, INTERNAL_SHARED_SECRET } from "../config/config";

// Server-to-server hacia orders-service (endpoints /internal/hub/* con secreto
// compartido). El scope hub↔orden lo re-valida orders (defensa en profundidad);
// el scope del BUSINESS_VIEWER lo impone ESTE servicio antes de llamar.

function headers() {
    return INTERNAL_SHARED_SECRET ? { "x-ordena-secret": INTERNAL_SHARED_SECRET } : {};
}

export interface HubOrdersQuery {
    page?: number;
    limit?: number;
    businessId?: string;
    status?: string;
    from?: string;
    to?: string;
    /** Número visible (#1042), ID completo o fragmento final del _id. */
    q?: string;
    /** Sprint 3: confirmación del hub (pending | confirmed | rejected). */
    confirmation?: string;
    /** Sprint 3: estado de la bolsa (published | assigned | in_delivery | delivered…). */
    assignment?: string;
    driverId?: string;
    /** Portal del negocio: nunca ve pedidos pendientes de confirmación. */
    excludePendingConfirmation?: "1";
}

export async function getHubOrders(hubId: string, query: HubOrdersQuery) {
    const { data } = await axios.get(`${ORDERS_SERVICE_LINK}/internal/hub/${hubId}/orders`, {
        params: query,
        timeout: 15000,
        headers: headers(),
    });
    return data;
}

export async function getHubOrdersSummary(hubId: string, from?: string, to?: string, businessId?: string, excludePendingConfirmation = false) {
    const { data } = await axios.get(`${ORDERS_SERVICE_LINK}/internal/hub/${hubId}/summary`, {
        params: { from, to, businessId, ...(excludePendingConfirmation ? { excludePendingConfirmation: "1" } : {}) },
        timeout: 15000,
        headers: headers(),
    });
    return data;
}

export async function updateHubOrderStatus(
    hubId: string,
    orderId: string,
    body: { order_status?: string; payment_status?: string; businessId?: string }
) {
    const { data } = await axios.patch(
        `${ORDERS_SERVICE_LINK}/internal/hub/${hubId}/orders/${orderId}/status`,
        body,
        { timeout: 15000, headers: headers() }
    );
    return data;
}

/**
 * Aviso al repartidor del hub. orders resuelve el número (del hub para pedidos
 * de hub) y marca el envío único; aquí solo se proxea con el businessId del
 * pedido, que es lo que su middleware exige.
 */
export async function notifyDeliveryPersonExternal(businessId: string, orderId: string) {
    const { data } = await axios.post(
        `${ORDERS_SERVICE_LINK}/admin/orders/${orderId}/notify-delivery`,
        {},
        { timeout: 15000, headers: { ...headers(), "x-business-id": businessId } }
    );
    return data;
}

// ── Sprint 3: flujo del pedido (confirmación del hub + bolsa de repartidores) ──
export type HubOrderFlowAction =
    | "confirm"
    | "reject"
    | "publish"
    | "unpublish"
    | "claim"
    | "assign"
    | "unassign"
    | "delivery_status"
    // Sprint 5: el hub corrige el cobro registrado en un pedido ya entregado.
    | "set_collection";

/** Sprint 5: cómo cobró el repartidor al entregar (base de su liquidación). */
export interface HubOrderFlowCollection {
    /** true = el repartidor recibió el pago del cliente (efectivo o billetera). */
    collected: boolean;
    method?: string;
    /** Monto cobrado; si falta, orders usa el total del pedido. */
    amount?: number;
}

export interface HubOrderFlowBody {
    action: HubOrderFlowAction;
    actor: { id: string; name: string; role: string };
    publish?: boolean;
    reason?: string;
    driver?: { id: string; name: string };
    republish?: boolean;
    status?: string;
    note?: string | null;
    /** delivery_status (status delivered) y set_collection. */
    collection?: HubOrderFlowCollection;
}

export async function hubOrderFlowExternal(hubId: string, orderId: string, body: HubOrderFlowBody) {
    const { data } = await axios.post(
        `${ORDERS_SERVICE_LINK}/internal/hub/${hubId}/orders/${orderId}/flow`,
        body,
        { timeout: 15000, headers: headers() }
    );
    return data;
}

/** Pedidos para la app del repartidor: bolsa (pool), los suyos (mine) o entregados (history). */
export async function getDriverOrdersExternal(hubId: string, driverId: string, scope: "pool" | "mine" | "history") {
    const { data } = await axios.get(`${ORDERS_SERVICE_LINK}/internal/hub/${hubId}/driver-orders`, {
        params: { driverId, scope },
        timeout: 15000,
        headers: headers(),
    });
    return data;
}

/** Lineas de liquidacion (F4): pedidos entregados+pagados del periodo, sin PII. */
export async function getHubSettlementLines(hubId: string, businessId: string, from: string, to: string) {
    const { data } = await axios.get(`${ORDERS_SERVICE_LINK}/internal/hub/${hubId}/settlement-lines`, {
        timeout: 30000,
        headers: headers(),
        params: { businessId, from, to },
    });
    return data;
}

// ── Sprint 5: liquidación de repartidores ──
/** Línea que devuelve orders por cada entrega del repartidor en el rango (sin PII). */
export interface DriverSettlementLineExternal {
    orderId: string;
    orderNumber: number | null;
    businessId: string;
    deliveredAt: string;
    orderTotal: number;
    deliveryCost: number;
    distanceKm: number | null;
    paymentType: string | null;
    paymentStatus: string | null;
    collectedByDriver: boolean;
    collectedMethod: string | null;
    collectedAmount: number;
}

export interface DriverSettlementLinesData {
    lines: DriverSettlementLineExternal[];
    deliveriesCount: number;
    collectedTotal: number;
    deliveryFeesTotal: number;
    orderTotalsTotal: number;
    truncated: boolean;
}

/**
 * Entregas de UN repartidor (delivery_assignment delivered) entre from y to,
 * con lo que cobró al cliente en cada una. Base de su liquidación y de "Mi cuenta".
 */
export async function getDriverSettlementLines(hubId: string, driverId: string, from: string, to: string) {
    const { data } = await axios.get(`${ORDERS_SERVICE_LINK}/internal/hub/${hubId}/driver-settlement-lines`, {
        timeout: 30000,
        headers: headers(),
        params: { driverId, from, to },
    });
    return data as { status: boolean; statusCode: number; message: string; data: DriverSettlementLinesData };
}
