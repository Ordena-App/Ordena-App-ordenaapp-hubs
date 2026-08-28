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
exports.createHubCheckoutSessionExternal = createHubCheckoutSessionExternal;
exports.createHubPortalSessionExternal = createHubPortalSessionExternal;
const axios_1 = __importDefault(require("axios"));
const config_1 = require("../config/config");
// Facturación del hub (F3 v2): checkout y portal de Stripe viven en
// payments-service. Endpoints INTERNOS (x-ordena-secret): el hubId viaja en el
// body porque ya fue autenticado aquí (JWT del hub) — payments no re-deriva.
function headers() {
    return { "x-ordena-secret": config_1.INTERNAL_SHARED_SECRET };
}
function createHubCheckoutSessionExternal(body) {
    return __awaiter(this, void 0, void 0, function* () {
        const { data } = yield axios_1.default.post(`${config_1.PAYMENTS_SERVICE_LINK}/stripe/hub/create-checkout-session`, body, {
            timeout: 20000,
            headers: headers(),
        });
        return data;
    });
}
function createHubPortalSessionExternal(body) {
    return __awaiter(this, void 0, void 0, function* () {
        const { data } = yield axios_1.default.post(`${config_1.PAYMENTS_SERVICE_LINK}/stripe/hub/create-portal-session`, body, {
            timeout: 20000,
            headers: headers(),
        });
        return data;
    });
}
