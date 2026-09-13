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
exports.notifyDeliveryPersonExternal = notifyDeliveryPersonExternal;
exports.hubOrderFlowExternal = hubOrderFlowExternal;
exports.getDriverOrdersExternal = getDriverOrdersExternal;
exports.getHubSettlementLines = getHubSettlementLines;
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
function getHubOrdersSummary(hubId_1, from_1, to_1, businessId_1) {
    return __awaiter(this, arguments, void 0, function* (hubId, from, to, businessId, excludePendingConfirmation = false) {
        const { data } = yield axios_1.default.get(`${config_1.ORDERS_SERVICE_LINK}/internal/hub/${hubId}/summary`, {
            params: Object.assign({ from, to, businessId }, (excludePendingConfirmation ? { excludePendingConfirmation: "1" } : {})),
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
/**
 * Aviso al repartidor del hub. orders resuelve el número (del hub para pedidos
 * de hub) y marca el envío único; aquí solo se proxea con el businessId del
 * pedido, que es lo que su middleware exige.
 */
function notifyDeliveryPersonExternal(businessId, orderId) {
    return __awaiter(this, void 0, void 0, function* () {
        const { data } = yield axios_1.default.post(`${config_1.ORDERS_SERVICE_LINK}/admin/orders/${orderId}/notify-delivery`, {}, { timeout: 15000, headers: Object.assign(Object.assign({}, headers()), { "x-business-id": businessId }) });
        return data;
    });
}
function hubOrderFlowExternal(hubId, orderId, body) {
    return __awaiter(this, void 0, void 0, function* () {
        const { data } = yield axios_1.default.post(`${config_1.ORDERS_SERVICE_LINK}/internal/hub/${hubId}/orders/${orderId}/flow`, body, { timeout: 15000, headers: headers() });
        return data;
    });
}
/** Pedidos para la app del repartidor: bolsa (pool), los suyos (mine) o entregados (history). */
function getDriverOrdersExternal(hubId, driverId, scope) {
    return __awaiter(this, void 0, void 0, function* () {
        const { data } = yield axios_1.default.get(`${config_1.ORDERS_SERVICE_LINK}/internal/hub/${hubId}/driver-orders`, {
            params: { driverId, scope },
            timeout: 15000,
            headers: headers(),
        });
        return data;
    });
}
/** Lineas de liquidacion (F4): pedidos entregados+pagados del periodo, sin PII. */
function getHubSettlementLines(hubId, businessId, from, to) {
    return __awaiter(this, void 0, void 0, function* () {
        const { data } = yield axios_1.default.get(`${config_1.ORDERS_SERVICE_LINK}/internal/hub/${hubId}/settlement-lines`, {
            timeout: 30000,
            headers: headers(),
            params: { businessId, from, to },
        });
        return data;
    });
}
