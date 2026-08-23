"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getMyHubPaymentAccounts = getMyHubPaymentAccounts;
exports.createMyHubPaymentAccount = createMyHubPaymentAccount;
exports.updateMyHubPaymentAccount = updateMyHubPaymentAccount;
exports.deleteMyHubPaymentAccount = deleteMyHubPaymentAccount;
const paymentsService_external_1 = require("../services/paymentsService.external");
// Configuración de los métodos de pago CENTRALIZADOS del hub (decisión F2):
// el hub define SUS métodos y aparecen en los checkouts de todos sus negocios.
// CRUD proxy hacia payments-service con la key del hub. Solo OWNER/ADMIN.
function validMethod(res, method) {
    if (!paymentsService_external_1.HUB_PAYMENT_METHODS.has(method)) {
        res.status(400).json({
            status: false,
            statusCode: 400,
            message: `Método no soportado. Usa uno de: ${[...paymentsService_external_1.HUB_PAYMENT_METHODS].join(", ")}`,
            data: {},
        });
        return false;
    }
    return true;
}
function upstreamError(res, error, action) {
    var _a, _b, _c;
    const upstreamStatus = (_a = error === null || error === void 0 ? void 0 : error.response) === null || _a === void 0 ? void 0 : _a.status;
    // Los 4xx del upstream traen mensajes útiles (validaciones de campos) — se propagan.
    if (upstreamStatus && upstreamStatus >= 400 && upstreamStatus < 500 && ((_b = error === null || error === void 0 ? void 0 : error.response) === null || _b === void 0 ? void 0 : _b.data)) {
        return res.status(upstreamStatus).json(error.response.data);
    }
    console.error(`Error en ${action}:`, ((_c = error === null || error === void 0 ? void 0 : error.response) === null || _c === void 0 ? void 0 : _c.data) || (error === null || error === void 0 ? void 0 : error.message) || error);
    return res.status(502).json({
        status: false,
        statusCode: 502,
        message: `No se pudo ${action} (payments-service respondió ${upstreamStatus !== null && upstreamStatus !== void 0 ? upstreamStatus : "sin conexión"})`,
        data: {},
    });
}
/** GET /api/hubs/me/payment-accounts/:method */
function getMyHubPaymentAccounts(req, res) {
    return __awaiter(this, void 0, void 0, function* () {
        const ctx = req.hubContext;
        const method = String(req.params.method);
        if (!validMethod(res, method))
            return;
        try {
            const resp = yield (0, paymentsService_external_1.listHubPaymentAccounts)(ctx.hubId, method);
            return res.status(200).json(resp);
        }
        catch (error) {
            return upstreamError(res, error, "listar las cuentas");
        }
    });
}
/** POST /api/hubs/me/payment-accounts/:method — body = campos del método */
function createMyHubPaymentAccount(req, res) {
    return __awaiter(this, void 0, void 0, function* () {
        const ctx = req.hubContext;
        const method = String(req.params.method);
        if (!validMethod(res, method))
            return;
        try {
            const resp = yield (0, paymentsService_external_1.createHubPaymentAccount)(ctx.hubId, method, req.body || {});
            return res.status(201).json(resp);
        }
        catch (error) {
            return upstreamError(res, error, "crear la cuenta");
        }
    });
}
/** PUT /api/hubs/me/payment-accounts/:method/:accountId */
function updateMyHubPaymentAccount(req, res) {
    return __awaiter(this, void 0, void 0, function* () {
        const ctx = req.hubContext;
        const method = String(req.params.method);
        if (!validMethod(res, method))
            return;
        try {
            const resp = yield (0, paymentsService_external_1.updateHubPaymentAccount)(ctx.hubId, method, String(req.params.accountId), req.body || {});
            return res.status(200).json(resp);
        }
        catch (error) {
            return upstreamError(res, error, "actualizar la cuenta");
        }
    });
}
/** DELETE /api/hubs/me/payment-accounts/:method/:accountId */
function deleteMyHubPaymentAccount(req, res) {
    return __awaiter(this, void 0, void 0, function* () {
        const ctx = req.hubContext;
        const method = String(req.params.method);
        if (!validMethod(res, method))
            return;
        try {
            const resp = yield (0, paymentsService_external_1.deleteHubPaymentAccount)(ctx.hubId, method, String(req.params.accountId));
            return res.status(200).json(resp);
        }
        catch (error) {
            return upstreamError(res, error, "eliminar la cuenta");
        }
    });
}
