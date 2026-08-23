import axios from "axios";
import { PAYMENTS_SERVICE_LINK } from "../config/config";

// Pagos CENTRALIZADOS del hub: sus métodos se guardan en payments-service
// bajo la key del HUB (mismos modelos/endpoints que un negocio, keyed por
// hubId). El checkout público (/pagar) ya los consulta por hubId.
//
// Whitelist de métodos manuales soportados (mismo set que muestra /pagar).
export const HUB_PAYMENT_METHODS = new Set([
    "bank-accounts",
    "paypal",
    "sinpe",
    "nequi",
    "daviplata",
    "mercadopago",
    "yape",
    "tigomoney",
    "yappy",
    "wise",
    "zelle",
    "blik",
    "oxxo",
    "revolut",
]);

function headers(hubId: string) {
    // payments valida solo la presencia de x-business-id; la key del hub cumple
    // el rol de "dueño" de la cuenta. El planGate de payments reconoce hubs.
    return { "x-business-id": hubId };
}

export async function listHubPaymentAccounts(hubId: string, method: string) {
    const { data } = await axios.get(`${PAYMENTS_SERVICE_LINK}/${method}/${hubId}`, {
        timeout: 15000,
        headers: headers(hubId),
    });
    return data;
}

export async function createHubPaymentAccount(hubId: string, method: string, body: Record<string, unknown>) {
    const { data } = await axios.post(
        `${PAYMENTS_SERVICE_LINK}/${method}`,
        { ...body, businessId: hubId },
        { timeout: 15000, headers: headers(hubId) }
    );
    return data;
}

export async function updateHubPaymentAccount(
    hubId: string,
    method: string,
    accountId: string,
    body: Record<string, unknown>
) {
    // bank-accounts usa PUT; el resto PATCH — probamos el verbo correcto por método.
    const url = `${PAYMENTS_SERVICE_LINK}/${method}/${hubId}/${accountId}`;
    const cfg = { timeout: 15000, headers: headers(hubId) };
    if (method === "bank-accounts") {
        const { data } = await axios.put(url, body, cfg);
        return data;
    }
    const { data } = await axios.patch(url, body, cfg);
    return data;
}

export async function deleteHubPaymentAccount(hubId: string, method: string, accountId: string) {
    const { data } = await axios.delete(`${PAYMENTS_SERVICE_LINK}/${method}/${hubId}/${accountId}`, {
        timeout: 15000,
        headers: headers(hubId),
    });
    return data;
}
