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
exports.createHubBusiness = createHubBusiness;
exports.getBusinessesByHubId = getBusinessesByHubId;
exports.getBusinessById = getBusinessById;
exports.assertBusinessBelongsToHub = assertBusinessBelongsToHub;
exports.patchBusinessInternal = patchBusinessInternal;
exports.getBusinessSettingsExternal = getBusinessSettingsExternal;
exports.patchBusinessWeeklyHours = patchBusinessWeeklyHours;
exports.uploadBusinessLogoExternal = uploadBusinessLogoExternal;
exports.propagateHubStorefrontThemeExternal = propagateHubStorefrontThemeExternal;
exports.propagateHubDeliveryDefaultsExternal = propagateHubDeliveryDefaultsExternal;
exports.addHubDomainExternal = addHubDomainExternal;
exports.hubDomainStatusExternal = hubDomainStatusExternal;
const axios_1 = __importDefault(require("axios"));
const config_1 = require("../config/config");
// ============================================================================
// Contrato F1 con business-service (server-to-server).
//
// Estos endpoints son la contraparte que business-service debe exponer para el
// Modo Multi-Negocio (espejo del patrón agencies: GET /businesses/agency/:id).
// Hasta que aterricen, las llamadas devuelven el error del upstream tal cual —
// el controller lo traduce a un 502 explicativo.
//
//   POST  /business/hub-managed          → crea Business con context HUB_MANAGED,
//                                          hubId, planRef.kind HUB_PLAN. No exige
//                                          cuenta Firebase del dueño.
//   GET   /businesses/hub/:hubId         → lista businesses del hub (proyección
//                                          ligera: nombre, slug, logo, status,
//                                          horario resumido).
//   PATCH /business/:id/internal         → ya EXISTE: actualizaciones internas
//                                          (status operativo, etc.).
// ============================================================================
function internalHeaders(extra) {
    return Object.assign(Object.assign({}, (config_1.INTERNAL_SHARED_SECRET ? { "x-ordena-secret": config_1.INTERNAL_SHARED_SECRET } : {})), (extra || {}));
}
function createHubBusiness(payload) {
    return __awaiter(this, void 0, void 0, function* () {
        const { data } = yield axios_1.default.post(`${config_1.BUSINESS_SERVICE_LINK}/business/hub-managed`, payload, { timeout: 15000, headers: internalHeaders() });
        return data;
    });
}
function getBusinessesByHubId(hubId) {
    return __awaiter(this, void 0, void 0, function* () {
        const { data } = yield axios_1.default.get(`${config_1.BUSINESS_SERVICE_LINK}/businesses/hub/${hubId}`, { timeout: 15000, headers: internalHeaders() });
        return data;
    });
}
function getBusinessById(businessId) {
    return __awaiter(this, void 0, void 0, function* () {
        const { data } = yield axios_1.default.get(`${config_1.BUSINESS_SERVICE_LINK}/business/${businessId}`, { timeout: 15000, headers: internalHeaders({ "x-business-id": businessId }) });
        return data;
    });
}
/**
 * Verificación de pertenencia hub ↔ business. TODA operación sobre un negocio
 * debe pasar por aquí antes de tocar/leer nada: es la garantía de que nunca se
 * expone información entre negocios ni entre hubs.
 */
function assertBusinessBelongsToHub(hubId, businessId) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b, _c, _d, _e;
        const resp = yield getBusinessById(businessId);
        // GET /business/:id devuelve el negocio SIN wrapper ({_id, name, hubId...});
        // toleramos también shapes envueltos por si el upstream cambia.
        const raw = (_e = (_d = (_c = (_b = (_a = resp === null || resp === void 0 ? void 0 : resp.data) === null || _a === void 0 ? void 0 : _a.business) !== null && _b !== void 0 ? _b : resp === null || resp === void 0 ? void 0 : resp.business) !== null && _c !== void 0 ? _c : resp === null || resp === void 0 ? void 0 : resp.data) !== null && _d !== void 0 ? _d : resp) !== null && _e !== void 0 ? _e : null;
        const business = raw && raw._id ? raw : null;
        const businessHubId = (business === null || business === void 0 ? void 0 : business.hubId) ? String(business.hubId) : null;
        if (!business || businessHubId !== String(hubId)) {
            const err = new Error("business_not_in_hub");
            err.code = "BUSINESS_NOT_IN_HUB";
            throw err;
        }
        return business;
    });
}
function patchBusinessInternal(businessId, patch) {
    return __awaiter(this, void 0, void 0, function* () {
        const { data } = yield axios_1.default.patch(`${config_1.BUSINESS_SERVICE_LINK}/business/${businessId}/internal`, patch, { timeout: 15000, headers: internalHeaders({ "x-business-id": businessId }) });
        return data;
    });
}
function getBusinessSettingsExternal(businessId) {
    return __awaiter(this, void 0, void 0, function* () {
        const { data } = yield axios_1.default.get(`${config_1.BUSINESS_SERVICE_LINK}/business-settings/${businessId}`, { timeout: 15000, headers: internalHeaders({ "x-business-id": businessId }) });
        return data;
    });
}
/** PATCH horario semanal (+ timezone y allowSalesOutsideHours) del negocio. */
function patchBusinessWeeklyHours(businessId, body) {
    return __awaiter(this, void 0, void 0, function* () {
        const { data } = yield axios_1.default.patch(`${config_1.BUSINESS_SERVICE_LINK}/business-settings/${businessId}/hours/weekly`, body, { timeout: 15000, headers: internalHeaders({ "x-business-id": businessId }) });
        return data;
    });
}
/** Sube el logo del negocio (endpoint interno hub-logo; FormData nativo Node >= 18). */
function uploadBusinessLogoExternal(businessId, file) {
    return __awaiter(this, void 0, void 0, function* () {
        const FormDataCtor = globalThis.FormData;
        if (!FormDataCtor)
            throw new Error("Node >= 18 requerido para subir imágenes");
        const { Blob } = require("buffer");
        const fd = new FormDataCtor();
        fd.append("image", new Blob([file.buffer], { type: file.mimetype }), file.originalname);
        const { data } = yield axios_1.default.patch(`${config_1.BUSINESS_SERVICE_LINK}/business/${businessId}/hub-logo`, fd, { timeout: 30000, headers: internalHeaders({ "x-business-id": businessId }) });
        return data;
    });
}
/**
 * Propaga el branding del hub al tema del storefront de TODOS sus negocios
 * (storefrontButtonTheme.global). Complemento de la siembra al crear: cubre
 * negocios anteriores a la siembra y cambios de color posteriores del hub.
 */
function propagateHubStorefrontThemeExternal(hubId, body) {
    return __awaiter(this, void 0, void 0, function* () {
        const { data } = yield axios_1.default.patch(`${config_1.BUSINESS_SERVICE_LINK}/businesses/hub/${hubId}/storefront-theme`, body, { timeout: 20000, headers: internalHeaders() });
        return data;
    });
}
/**
 * Propaga la ubicación de entrega por defecto del hub (deliveryDefaults) a
 * delivery_options.default_delivery_location de TODOS sus negocios. Con body
 * vacío limpia el prefill. Complemento de la siembra al crear.
 */
function propagateHubDeliveryDefaultsExternal(hubId, body) {
    return __awaiter(this, void 0, void 0, function* () {
        const { data } = yield axios_1.default.patch(`${config_1.BUSINESS_SERVICE_LINK}/businesses/hub/${hubId}/delivery-defaults`, body, { timeout: 20000, headers: internalHeaders() });
        return data;
    });
}
// ── Dominio custom del hub (F4): proxies de Vercel via business ──
function addHubDomainExternal(domain) {
    return __awaiter(this, void 0, void 0, function* () {
        const { data } = yield axios_1.default.post(`${config_1.BUSINESS_SERVICE_LINK}/internal/hub-domains`, { domain }, { timeout: 20000, headers: internalHeaders() });
        return data;
    });
}
function hubDomainStatusExternal(domain) {
    return __awaiter(this, void 0, void 0, function* () {
        const { data } = yield axios_1.default.get(`${config_1.BUSINESS_SERVICE_LINK}/internal/hub-domains/status`, {
            timeout: 20000,
            headers: internalHeaders(),
            params: { domain },
        });
        return data;
    });
}
