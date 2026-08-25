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
exports.createBusinessForMyHub = createBusinessForMyHub;
exports.getMyHubBusinesses = getMyHubBusinesses;
exports.updateBusinessOperationalStatus = updateBusinessOperationalStatus;
exports.getMyHubBusinessDetail = getMyHubBusinessDetail;
exports.updateMyHubBusinessInfo = updateMyHubBusinessInfo;
exports.uploadMyHubBusinessLogo = uploadMyHubBusinessLogo;
exports.updateMyHubBusinessHours = updateMyHubBusinessHours;
const hubModel_1 = __importDefault(require("../models/hubModel"));
const businessService_external_1 = require("../services/businessService.external");
// Traduce fallos del upstream (business-service) a respuestas claras.
// Mientras el contrato F1 no esté desplegado allá, los 404 upstream se
// reportan como 502 con mensaje explícito — nunca como "no hay negocios".
function upstreamError(res, error, action) {
    var _a, _b;
    if ((error === null || error === void 0 ? void 0 : error.code) === "BUSINESS_NOT_IN_HUB") {
        return res.status(403).json({
            status: false,
            statusCode: 403,
            message: "El negocio no pertenece a este hub",
            data: {},
        });
    }
    const upstreamStatus = (_a = error === null || error === void 0 ? void 0 : error.response) === null || _a === void 0 ? void 0 : _a.status;
    console.error(`Error en ${action}:`, ((_b = error === null || error === void 0 ? void 0 : error.response) === null || _b === void 0 ? void 0 : _b.data) || (error === null || error === void 0 ? void 0 : error.message) || error);
    return res.status(502).json({
        status: false,
        statusCode: 502,
        message: `No se pudo ${action} (business-service respondió ${upstreamStatus !== null && upstreamStatus !== void 0 ? upstreamStatus : "sin conexión"})`,
        data: {},
    });
}
/**
 * POST /api/hubs/me/businesses  (HUB_OWNER/HUB_ADMIN)
 * Crea un negocio administrado por el hub (context HUB_MANAGED en business).
 * No requiere que el dueño del negocio tenga cuenta de Ordena.
 */
function createBusinessForMyHub(req, res) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b, _c, _d, _e;
        const ctx = req.hubContext;
        try {
            const { name, slug, description, industry, country_code, phone, email, address, region_settings } = req.body || {};
            if (!name || !industry || !country_code || !phone) {
                return res.status(400).json({
                    status: false,
                    statusCode: 400,
                    message: "name, industry, country_code y phone son requeridos",
                    data: {},
                });
            }
            const hub = yield hubModel_1.default.findById(ctx.hubId);
            if (!hub) {
                return res.status(404).json({
                    status: false,
                    statusCode: 404,
                    message: "Hub no encontrado",
                    data: {},
                });
            }
            // Límite comercial del plan (businessesIncluded; -1 = ilimitado).
            const limit = (_c = (_b = (_a = hub.subscription) === null || _a === void 0 ? void 0 : _a.limits) === null || _b === void 0 ? void 0 : _b.businessesIncluded) !== null && _c !== void 0 ? _c : -1;
            if (limit !== -1 && hub.usageMetrics.businessesCount >= limit) {
                return res.status(403).json({
                    status: false,
                    statusCode: 403,
                    message: `Alcanzaste el límite de ${limit} negocios de tu plan. Mejora tu plan para agregar más.`,
                    data: { limit, current: hub.usageMetrics.businessesCount },
                });
            }
            const created = yield (0, businessService_external_1.createHubBusiness)(Object.assign({ hubId: ctx.hubId, name,
                slug,
                description,
                industry,
                country_code,
                phone,
                email,
                address, region_settings: region_settings || {
                    country: hub.country,
                    currency: hub.currency,
                    language: hub.language,
                } }, (((_d = hub.branding) === null || _d === void 0 ? void 0 : _d.primaryColor)
                ? {
                    branding: {
                        primaryColor: hub.branding.primaryColor,
                        primaryForeground: hub.branding.primaryForeground,
                    },
                }
                : {})));
            yield hubModel_1.default.updateOne({ _id: ctx.hubId }, { $inc: { "usageMetrics.businessesCount": 1 }, $set: { updated_at: new Date() } });
            return res.status(201).json({
                status: true,
                statusCode: 201,
                message: "Negocio creado correctamente",
                data: (_e = created === null || created === void 0 ? void 0 : created.data) !== null && _e !== void 0 ? _e : created,
            });
        }
        catch (error) {
            return upstreamError(res, error, "crear el negocio");
        }
    });
}
/** GET /api/hubs/me/businesses — listado de negocios del hub. */
function getMyHubBusinesses(req, res) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a;
        const ctx = req.hubContext;
        try {
            const resp = yield (0, businessService_external_1.getBusinessesByHubId)(ctx.hubId);
            return res.status(200).json({
                status: true,
                statusCode: 200,
                message: "Negocios del hub",
                data: (_a = resp === null || resp === void 0 ? void 0 : resp.data) !== null && _a !== void 0 ? _a : resp,
            });
        }
        catch (error) {
            return upstreamError(res, error, "listar los negocios");
        }
    });
}
/**
 * PATCH /api/hubs/me/businesses/:businessId/operational-status  (roles de hub)
 * Cambia el estado operativo del negocio: active | paused | temporarily_closed.
 * "paused" = dentro de horario pero sin aceptar pedidos (ej. saturación).
 */
function updateBusinessOperationalStatus(req, res) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a;
        const ctx = req.hubContext;
        try {
            const businessId = String(req.params.businessId);
            const { operationalStatus } = req.body || {};
            const allowed = ["active", "paused", "temporarily_closed"];
            if (!allowed.includes(operationalStatus)) {
                return res.status(400).json({
                    status: false,
                    statusCode: 400,
                    message: `operationalStatus debe ser uno de: ${allowed.join(", ")}`,
                    data: {},
                });
            }
            // Candado de pertenencia: SIEMPRE antes de tocar el negocio.
            yield (0, businessService_external_1.assertBusinessBelongsToHub)(ctx.hubId, businessId);
            const updated = yield (0, businessService_external_1.patchBusinessInternal)(businessId, { operationalStatus });
            return res.status(200).json({
                status: true,
                statusCode: 200,
                message: "Estado operativo actualizado",
                data: (_a = updated === null || updated === void 0 ? void 0 : updated.data) !== null && _a !== void 0 ? _a : updated,
            });
        }
        catch (error) {
            return upstreamError(res, error, "actualizar el estado del negocio");
        }
    });
}
/**
 * GET /api/hubs/me/businesses/:businessId — detalle para /hub-admin:
 * identidad pública del negocio + horario (businessHours con
 * allowSalesOutsideHours) leído de sus settings.
 */
function getMyHubBusinessDetail(req, res) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b, _c, _d;
        const ctx = req.hubContext;
        try {
            const businessId = String(req.params.businessId);
            const business = yield (0, businessService_external_1.assertBusinessBelongsToHub)(ctx.hubId, businessId);
            let businessHours = null;
            try {
                const settingsResp = yield (0, businessService_external_1.getBusinessSettingsExternal)(businessId);
                businessHours = (_c = (_b = (_a = settingsResp === null || settingsResp === void 0 ? void 0 : settingsResp.data) === null || _a === void 0 ? void 0 : _a.businessHours) !== null && _b !== void 0 ? _b : settingsResp === null || settingsResp === void 0 ? void 0 : settingsResp.businessHours) !== null && _c !== void 0 ? _c : null;
            }
            catch (e) {
                console.error("[business-detail] settings fetch:", ((_d = e === null || e === void 0 ? void 0 : e.response) === null || _d === void 0 ? void 0 : _d.status) || (e === null || e === void 0 ? void 0 : e.message));
            }
            return res.status(200).json({
                status: true,
                statusCode: 200,
                message: "Detalle del negocio",
                data: {
                    business: {
                        _id: business._id,
                        name: business.name,
                        hubSlug: business.hubSlug,
                        store_link: business.store_link,
                        image_url: business.image_url,
                        description: business.description,
                        industry: business.industry,
                        phone: business.phone,
                        address: business.address,
                        operationalStatus: business.operationalStatus || "active",
                    },
                    businessHours,
                },
            });
        }
        catch (error) {
            return upstreamError(res, error, "cargar el negocio");
        }
    });
}
// Campos de identidad que el hub puede editar de sus negocios.
const BUSINESS_INFO_FIELDS = ["name", "description", "phone", "address"];
/** PATCH /api/hubs/me/businesses/:businessId — info básica (vía patch interno). */
function updateMyHubBusinessInfo(req, res) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a;
        const ctx = req.hubContext;
        try {
            const businessId = String(req.params.businessId);
            yield (0, businessService_external_1.assertBusinessBelongsToHub)(ctx.hubId, businessId);
            const patch = {};
            for (const f of BUSINESS_INFO_FIELDS) {
                if (typeof (req.body || {})[f] === "string")
                    patch[f] = req.body[f];
            }
            if (Object.keys(patch).length === 0) {
                return res.status(400).json({
                    status: false,
                    statusCode: 400,
                    message: "Nada que actualizar",
                    data: {},
                });
            }
            const updated = yield (0, businessService_external_1.patchBusinessInternal)(businessId, patch);
            return res.status(200).json({
                status: true,
                statusCode: 200,
                message: "Negocio actualizado",
                data: (_a = updated === null || updated === void 0 ? void 0 : updated.data) !== null && _a !== void 0 ? _a : updated,
            });
        }
        catch (error) {
            return upstreamError(res, error, "actualizar el negocio");
        }
    });
}
/** POST /api/hubs/me/businesses/:businessId/logo (multipart 'image'). */
function uploadMyHubBusinessLogo(req, res) {
    return __awaiter(this, void 0, void 0, function* () {
        const ctx = req.hubContext;
        try {
            const businessId = String(req.params.businessId);
            yield (0, businessService_external_1.assertBusinessBelongsToHub)(ctx.hubId, businessId);
            const file = req.file;
            if (!file) {
                return res.status(400).json({
                    status: false,
                    statusCode: 400,
                    message: "Archivo 'image' requerido",
                    data: {},
                });
            }
            const resp = yield (0, businessService_external_1.uploadBusinessLogoExternal)(businessId, file);
            return res.status(200).json(resp);
        }
        catch (error) {
            return upstreamError(res, error, "subir el logo");
        }
    });
}
/**
 * PATCH /api/hubs/me/businesses/:businessId/hours
 * Body: { timezone?, weeklyHours?, allowSalesOutsideHours? } — mismo contrato
 * que el endpoint hours/weekly de business (valida overnight, solapes, etc.).
 */
function updateMyHubBusinessHours(req, res) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b;
        const ctx = req.hubContext;
        try {
            const businessId = String(req.params.businessId);
            yield (0, businessService_external_1.assertBusinessBelongsToHub)(ctx.hubId, businessId);
            const { timezone, weeklyHours, allowSalesOutsideHours } = req.body || {};
            const resp = yield (0, businessService_external_1.patchBusinessWeeklyHours)(businessId, Object.assign(Object.assign(Object.assign({}, (timezone !== undefined ? { timezone } : {})), (weeklyHours !== undefined ? { weeklyHours } : {})), (typeof allowSalesOutsideHours === "boolean" ? { allowSalesOutsideHours } : {})));
            return res.status(200).json(resp);
        }
        catch (error) {
            // Las validaciones de horario del upstream (400) traen mensajes útiles.
            const st = (_a = error === null || error === void 0 ? void 0 : error.response) === null || _a === void 0 ? void 0 : _a.status;
            if (st && st >= 400 && st < 500 && ((_b = error === null || error === void 0 ? void 0 : error.response) === null || _b === void 0 ? void 0 : _b.data)) {
                return res.status(st).json(error.response.data);
            }
            return upstreamError(res, error, "guardar el horario");
        }
    });
}
