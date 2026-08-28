import axios from "axios";
import { PAYMENTS_SERVICE_LINK, INTERNAL_SHARED_SECRET } from "../config/config";

// Facturación del hub (F3 v2): checkout y portal de Stripe viven en
// payments-service. Endpoints INTERNOS (x-ordena-secret): el hubId viaja en el
// body porque ya fue autenticado aquí (JWT del hub) — payments no re-deriva.

function headers() {
    return { "x-ordena-secret": INTERNAL_SHARED_SECRET };
}

export async function createHubCheckoutSessionExternal(body: {
    hubId: string;
    lookupKey: string;
    customerEmail: string;
    hubSlug?: string;
    trialDays?: number;
}) {
    const { data } = await axios.post(`${PAYMENTS_SERVICE_LINK}/stripe/hub/create-checkout-session`, body, {
        timeout: 20000,
        headers: headers(),
    });
    return data;
}

export async function createHubPortalSessionExternal(body: { hubId: string }) {
    const { data } = await axios.post(`${PAYMENTS_SERVICE_LINK}/stripe/hub/create-portal-session`, body, {
        timeout: 20000,
        headers: headers(),
    });
    return data;
}
