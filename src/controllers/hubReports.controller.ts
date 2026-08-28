import { Request, Response } from "express";
import hubModel from "../models/hubModel";
import { getHubReportOverview, getHubReportCustomers, HubReportQuery } from "../services/reportsService.external";

function upstreamError(res: Response, error: any, action: string): Response {
    const upstreamStatus = error?.response?.status;
    if (upstreamStatus && upstreamStatus >= 400 && upstreamStatus < 500 && error?.response?.data) {
        return res.status(upstreamStatus).json(error.response.data);
    }
    console.error(`Error en ${action}:`, error?.response?.data || error?.message || error);
    return res.status(502).json({
        status: false,
        statusCode: 502,
        message: `No se pudo ${action} (reportes respondió ${upstreamStatus ?? "sin conexión"})`,
        data: {},
    });
}

async function buildQuery(req: Request, hubId: string): Promise<HubReportQuery> {
    // La zona horaria del cálculo es la del HUB (no la del navegador): los
    // días del reporte deben cortar donde el operador vive.
    const hub = await hubModel.findById(hubId).select("timezone").lean();
    return {
        from: typeof req.query.from === "string" ? req.query.from : undefined,
        to: typeof req.query.to === "string" ? req.query.to : undefined,
        granularity: typeof req.query.granularity === "string" ? req.query.granularity : undefined,
        tz: (hub as any)?.timezone || undefined,
    };
}

/** GET /api/hubs/me/reports/overview  (roles de hub — el viewer no entra) */
export async function getMyHubReportOverview(req: Request, res: Response): Promise<Response> {
    const ctx = req.hubContext!;
    try {
        const query = await buildQuery(req, ctx.hubId);
        const resp = await getHubReportOverview(ctx.hubId, query);
        return res.status(200).json(resp);
    } catch (error: any) {
        return upstreamError(res, error, "cargar el informe del hub");
    }
}

/** GET /api/hubs/me/reports/customers  (roles de hub) */
export async function getMyHubReportCustomers(req: Request, res: Response): Promise<Response> {
    const ctx = req.hubContext!;
    try {
        const query = await buildQuery(req, ctx.hubId);
        const resp = await getHubReportCustomers(ctx.hubId, query);
        return res.status(200).json(resp);
    } catch (error: any) {
        return upstreamError(res, error, "cargar los clientes del hub");
    }
}
