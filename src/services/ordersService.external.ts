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

export async function getHubOrdersSummary(hubId: string, from?: string, to?: string) {
    const { data } = await axios.get(`${ORDERS_SERVICE_LINK}/internal/hub/${hubId}/summary`, {
        params: { from, to },
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
