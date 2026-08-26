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
}

export async function getHubOrders(hubId: string, query: HubOrdersQuery) {
    const { data } = await axios.get(`${ORDERS_SERVICE_LINK}/internal/hub/${hubId}/orders`, {
        params: query,
        timeout: 15000,
        headers: headers(),
    });
    return data;
}

export async function getHubOrdersSummary(hubId: string, from?: string, to?: string, businessId?: string) {
    const { data } = await axios.get(`${ORDERS_SERVICE_LINK}/internal/hub/${hubId}/summary`, {
        params: { from, to, businessId },
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
