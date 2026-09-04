import axios from "axios";
import { REPORTS_SERVICE_LINK, INTERNAL_SHARED_SECRET } from "../config/config";

// Reportes consolidados del hub (F3 v2 bloque C): las agregaciones viven en
// ms-reportes; aquí solo se proxean server-to-server con el secreto interno.
// El JWT del hub y su rol ya fueron validados en las rutas de este servicio.

function headers() {
    return { "x-ordena-secret": INTERNAL_SHARED_SECRET };
}

export interface HubReportQuery {
    from?: string;
    to?: string;
    tz?: string;
    granularity?: string;
}

export async function getHubReportOverview(hubId: string, query: HubReportQuery) {
    const { data } = await axios.get(`${REPORTS_SERVICE_LINK}/reports/hub/${hubId}/overview`, {
        timeout: 30000,
        headers: headers(),
        params: query,
    });
    return data;
}

export async function getHubReportCustomers(hubId: string, query: HubReportQuery) {
    const { data } = await axios.get(`${REPORTS_SERVICE_LINK}/reports/hub/${hubId}/customers/summary`, {
        timeout: 30000,
        headers: headers(),
        params: query,
    });
    return data;
}

export async function getHubReportVisits(hubId: string, query: HubReportQuery) {
    const { data } = await axios.get(`${REPORTS_SERVICE_LINK}/reports/hub/${hubId}/visits`, {
        timeout: 30000,
        headers: headers(),
        params: query,
    });
    return data;
}
