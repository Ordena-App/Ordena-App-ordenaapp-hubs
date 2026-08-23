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
exports.getHubOrders = getHubOrders;
exports.getHubOrdersSummary = getHubOrdersSummary;
exports.updateHubOrderStatus = updateHubOrderStatus;
const axios_1 = __importDefault(require("axios"));
const config_1 = require("../config/config");
// Server-to-server hacia orders-service (endpoints /internal/hub/* con secreto
// compartido). El scope hub↔orden lo re-valida orders (defensa en profundidad);
// el scope del BUSINESS_VIEWER lo impone ESTE servicio antes de llamar.
function headers() {
    return config_1.INTERNAL_SHARED_SECRET ? { "x-ordena-secret": config_1.INTERNAL_SHARED_SECRET } : {};
}
function getHubOrders(hubId, query) {
    return __awaiter(this, void 0, void 0, function* () {
        const { data } = yield axios_1.default.get(`${config_1.ORDERS_SERVICE_LINK}/internal/hub/${hubId}/orders`, {
            params: query,
            timeout: 15000,
            headers: headers(),
        });
        return data;
    });
}
function getHubOrdersSummary(hubId, from, to) {
    return __awaiter(this, void 0, void 0, function* () {
        const { data } = yield axios_1.default.get(`${config_1.ORDERS_SERVICE_LINK}/internal/hub/${hubId}/summary`, {
            params: { from, to },
            timeout: 15000,
            headers: headers(),
        });
        return data;
    });
}
function updateHubOrderStatus(hubId, orderId, body) {
    return __awaiter(this, void 0, void 0, function* () {
        const { data } = yield axios_1.default.patch(`${config_1.ORDERS_SERVICE_LINK}/internal/hub/${hubId}/orders/${orderId}/status`, body, { timeout: 15000, headers: headers() });
        return data;
    });
}
