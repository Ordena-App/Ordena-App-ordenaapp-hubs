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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.HUB_PAYMENT_METHODS = void 0;
exports.listHubPaymentAccounts = listHubPaymentAccounts;
exports.createHubPaymentAccount = createHubPaymentAccount;
exports.updateHubPaymentAccount = updateHubPaymentAccount;
exports.deleteHubPaymentAccount = deleteHubPaymentAccount;
const axios_1 = __importDefault(require("axios"));
const config_1 = require("../config/config");
// Pagos CENTRALIZADOS del hub: sus métodos se guardan en payments-service
// bajo la key del HUB (mismos modelos/endpoints que un negocio, keyed por
// hubId). El checkout público (/pagar) ya los consulta por hubId.
//
// Whitelist de métodos manuales soportados (mismo set que muestra /pagar).
exports.HUB_PAYMENT_METHODS = new Set([
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
function headers(hubId) {
    // payments valida solo la presencia de x-business-id; la key del hub cumple
    // el rol de "dueño" de la cuenta. El planGate de payments reconoce hubs.
    return { "x-business-id": hubId };
}
function listHubPaymentAccounts(hubId, method) {
    return __awaiter(this, void 0, void 0, function* () {
        const { data } = yield axios_1.default.get(`${config_1.PAYMENTS_SERVICE_LINK}/${method}/${hubId}`, {
            timeout: 15000,
            headers: headers(hubId),
        });
        return data;
    });
}
function createHubPaymentAccount(hubId, method, body) {
    return __awaiter(this, void 0, void 0, function* () {
        const { data } = yield axios_1.default.post(`${config_1.PAYMENTS_SERVICE_LINK}/${method}`, Object.assign(Object.assign({}, body), { businessId: hubId }), { timeout: 15000, headers: headers(hubId) });
        return data;
    });
}
function updateHubPaymentAccount(hubId, method, accountId, body) {
    return __awaiter(this, void 0, void 0, function* () {
        // bank-accounts usa PUT; el resto PATCH — probamos el verbo correcto por método.
        const url = `${config_1.PAYMENTS_SERVICE_LINK}/${method}/${hubId}/${accountId}`;
        const cfg = { timeout: 15000, headers: headers(hubId) };
        if (method === "bank-accounts") {
            const { data } = yield axios_1.default.put(url, body, cfg);
            return data;
        }
        const { data } = yield axios_1.default.patch(url, body, cfg);
        return data;
    });
}
function deleteHubPaymentAccount(hubId, method, accountId) {
    return __awaiter(this, void 0, void 0, function* () {
        const { data } = yield axios_1.default.delete(`${config_1.PAYMENTS_SERVICE_LINK}/${method}/${hubId}/${accountId}`, {
            timeout: 15000,
            headers: headers(hubId),
        });
        return data;
    });
}
