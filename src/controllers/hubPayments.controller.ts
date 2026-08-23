import { Request, Response } from "express";
import {
    HUB_PAYMENT_METHODS,
    listHubPaymentAccounts,
    createHubPaymentAccount,
    updateHubPaymentAccount,
    deleteHubPaymentAccount,
} from "../services/paymentsService.external";

// Configuración de los métodos de pago CENTRALIZADOS del hub (decisión F2):
// el hub define SUS métodos y aparecen en los checkouts de todos sus negocios.
// CRUD proxy hacia payments-service con la key del hub. Solo OWNER/ADMIN.

function validMethod(res: Response, method: string): boolean {
    if (!HUB_PAYMENT_METHODS.has(method)) {
        res.status(400).json({
            status: false,
            statusCode: 400,
            message: `Método no soportado. Usa uno de: ${[...HUB_PAYMENT_METHODS].join(", ")}`,
            data: {},
        });
        return false;
    }
    return true;
}

function upstreamError(res: Response, error: any, action: string): Response {
    const upstreamStatus = error?.response?.status;
    // Los 4xx del upstream traen mensajes útiles (validaciones de campos) — se propagan.
    if (upstreamStatus && upstreamStatus >= 400 && upstreamStatus < 500 && error?.response?.data) {
        return res.status(upstreamStatus).json(error.response.data);
    }
    console.error(`Error en ${action}:`, error?.response?.data || error?.message || error);
    return res.status(502).json({
        status: false,
        statusCode: 502,
        message: `No se pudo ${action} (payments-service respondió ${upstreamStatus ?? "sin conexión"})`,
        data: {},
    });
}

/** GET /api/hubs/me/payment-accounts/:method */
export async function getMyHubPaymentAccounts(req: Request, res: Response): Promise<Response | void> {
    const ctx = req.hubContext!;
    const method = String(req.params.method);
    if (!validMethod(res, method)) return;
    try {
        const resp = await listHubPaymentAccounts(ctx.hubId, method);
        return res.status(200).json(resp);
    } catch (error: any) {
        return upstreamError(res, error, "listar las cuentas");
    }
}

/** POST /api/hubs/me/payment-accounts/:method — body = campos del método */
export async function createMyHubPaymentAccount(req: Request, res: Response): Promise<Response | void> {
    const ctx = req.hubContext!;
    const method = String(req.params.method);
    if (!validMethod(res, method)) return;
    try {
        const resp = await createHubPaymentAccount(ctx.hubId, method, req.body || {});
        return res.status(201).json(resp);
    } catch (error: any) {
        return upstreamError(res, error, "crear la cuenta");
    }
}

/** PUT /api/hubs/me/payment-accounts/:method/:accountId */
export async function updateMyHubPaymentAccount(req: Request, res: Response): Promise<Response | void> {
    const ctx = req.hubContext!;
    const method = String(req.params.method);
    if (!validMethod(res, method)) return;
    try {
        const resp = await updateHubPaymentAccount(ctx.hubId, method, String(req.params.accountId), req.body || {});
        return res.status(200).json(resp);
    } catch (error: any) {
        return upstreamError(res, error, "actualizar la cuenta");
    }
}

/** DELETE /api/hubs/me/payment-accounts/:method/:accountId */
export async function deleteMyHubPaymentAccount(req: Request, res: Response): Promise<Response | void> {
    const ctx = req.hubContext!;
    const method = String(req.params.method);
    if (!validMethod(res, method)) return;
    try {
        const resp = await deleteHubPaymentAccount(ctx.hubId, method, String(req.params.accountId));
        return res.status(200).json(resp);
    } catch (error: any) {
        return upstreamError(res, error, "eliminar la cuenta");
    }
}
