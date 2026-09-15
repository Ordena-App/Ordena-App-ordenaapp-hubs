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
exports.signHubToken = signHubToken;
exports.verifyHubJWT = verifyHubJWT;
exports.requireHubRole = requireHubRole;
exports.requireCatalogAccess = requireCatalogAccess;
exports.resolveScopedBusinessId = resolveScopedBusinessId;
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const config_1 = require("../config/config");
const hubUserModel_1 = __importDefault(require("../models/hubUserModel"));
function extractId(value) {
    if (!value)
        return null;
    if (typeof value === "string")
        return value;
    if (typeof value === "object" && value !== null && "_id" in value) {
        return String(value._id);
    }
    return String(value);
}
function signHubToken(payload) {
    var _a;
    return jsonwebtoken_1.default.sign({
        userId: payload.userId,
        email: payload.email,
        hubId: payload.hubId,
        role: payload.role,
        businessId: (_a = payload.businessId) !== null && _a !== void 0 ? _a : null,
    }, config_1.JWT_SECRET, { expiresIn: "7d" });
}
function verifyHubJWT(req, res, next) {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return res.status(401).json({
            status: false,
            statusCode: 401,
            message: "Token de autorización requerido",
            data: {},
        });
    }
    const token = authHeader.split(" ")[1];
    try {
        const decoded = jsonwebtoken_1.default.verify(token, config_1.JWT_SECRET);
        const hubIdStr = extractId(decoded.hubId);
        if (!hubIdStr) {
            return res.status(403).json({
                status: false,
                statusCode: 403,
                message: "Usuario no asociado a ningún hub",
                data: {},
            });
        }
        req.hubContext = {
            userId: extractId(decoded.userId) || "",
            email: decoded.email,
            hubId: hubIdStr,
            role: decoded.role,
            businessId: extractId(decoded.businessId),
        };
        return next();
    }
    catch (error) {
        return res.status(401).json({
            status: false,
            statusCode: 401,
            message: "Token inválido o expirado",
            data: {},
        });
    }
}
// Restringe el endpoint a los roles indicados.
function requireHubRole(...roles) {
    return (req, res, next) => {
        const ctx = req.hubContext;
        if (!ctx || !roles.includes(ctx.role)) {
            return res.status(403).json({
                status: false,
                statusCode: 403,
                message: "No tienes permisos para esta acción",
                data: {},
            });
        }
        return next();
    };
}
/**
 * Acceso al catálogo (productos/categorías) de un negocio.
 *  - Roles de hub indicados → igual que requireHubRole.
 *  - BUSINESS_VIEWER → solo SU negocio (si la ruta trae :businessId debe ser el
 *    suyo) y solo si el hub le concedió `permissions.manageCatalog`. El permiso se
 *    lee de la DB en cada request: revocarlo aplica al instante aunque el JWT
 *    siga vigente. En rutas sin :businessId el controller valida la pertenencia.
 */
function requireCatalogAccess(...roles) {
    return (req, res, next) => __awaiter(this, void 0, void 0, function* () {
        var _a, _b;
        const ctx = req.hubContext;
        const deny = (message) => res.status(403).json({ status: false, statusCode: 403, message, data: {} });
        if (!ctx)
            return deny("No tienes permisos para esta acción");
        if (ctx.role === "BUSINESS_VIEWER") {
            const requested = ((_a = req.params) === null || _a === void 0 ? void 0 : _a.businessId) ? String(req.params.businessId) : "";
            if (!ctx.businessId || (requested && requested !== String(ctx.businessId))) {
                return deny("Solo puedes gestionar el catálogo de tu negocio");
            }
            try {
                const user = yield hubUserModel_1.default.findById(ctx.userId).select("permissions status").lean();
                if (!user || user.status !== "ACTIVE" || ((_b = user.permissions) === null || _b === void 0 ? void 0 : _b.manageCatalog) !== true) {
                    return deny("El hub no te ha habilitado la gestión del catálogo");
                }
            }
            catch (_c) {
                return deny("No se pudo validar el permiso");
            }
            return next();
        }
        if (!roles.includes(ctx.role))
            return deny("No tienes permisos para esta acción");
        return next();
    });
}
/**
 * Regla de aislamiento del Portal Business: un BUSINESS_VIEWER solo puede
 * operar sobre SU businessId (el del token). Para los roles de hub devuelve
 * el businessId solicitado tal cual (la pertenencia hub↔business se valida
 * en el controller contra business-service).
 *
 * Retorna null si el viewer intenta acceder a un negocio ajeno — el caller
 * debe responder 403 sin filtrar información.
 */
function resolveScopedBusinessId(ctx, requestedBusinessId) {
    if (ctx.role === "BUSINESS_VIEWER") {
        if (!ctx.businessId)
            return null;
        if (requestedBusinessId && requestedBusinessId !== ctx.businessId)
            return null;
        return ctx.businessId;
    }
    return requestedBusinessId || null;
}
