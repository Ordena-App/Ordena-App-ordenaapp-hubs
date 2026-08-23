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
exports.registerHubWithOwner = registerHubWithOwner;
exports.loginHubUser = loginHubUser;
exports.createHubUser = createHubUser;
exports.getHubUsers = getHubUsers;
exports.deleteHubUser = deleteHubUser;
const bcrypt_1 = __importDefault(require("bcrypt"));
const hubModel_1 = __importDefault(require("../models/hubModel"));
const hubUserModel_1 = __importDefault(require("../models/hubUserModel"));
const auth_1 = require("../utils/auth");
const slug_1 = require("../utils/slug");
const SALT_ROUNDS = 10;
/**
 * Onboarding self-serve: crea el Hub + su HUB_OWNER en una sola llamada.
 * POST /api/hub-users/register
 * Body: { hubName, slug?, country, currency, email, password, name? }
 *
 * El slug queda vivo al instante como {slug}.ordena.app (wildcard).
 */
function registerHubWithOwner(req, res) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            const { hubName, slug: rawSlug, country, currency, email, password, name, timezone, language } = req.body || {};
            if (!hubName || !country || !currency || !email || !password) {
                return res.status(400).json({
                    status: false,
                    statusCode: 400,
                    message: "hubName, country, currency, email y password son requeridos",
                    data: {},
                });
            }
            const slug = (0, slug_1.normalizeSlug)(rawSlug || hubName);
            if (!(0, slug_1.isValidSlug)(slug)) {
                return res.status(400).json({
                    status: false,
                    statusCode: 400,
                    message: "Slug inválido o reservado. Usa 3-40 caracteres (letras, números y guiones).",
                    data: { slug },
                });
            }
            const [slugTaken, emailTaken] = yield Promise.all([
                hubModel_1.default.exists({ slug }),
                hubUserModel_1.default.exists({ email: String(email).toLowerCase().trim() }),
            ]);
            if (slugTaken) {
                return res.status(409).json({
                    status: false,
                    statusCode: 409,
                    message: "Ese nombre de hub ya está en uso. Elige otro.",
                    data: { slug },
                });
            }
            if (emailTaken) {
                return res.status(409).json({
                    status: false,
                    statusCode: 409,
                    message: "Ya existe un usuario con ese email.",
                    data: {},
                });
            }
            const hub = yield hubModel_1.default.create(Object.assign(Object.assign(Object.assign({ name: hubName, slug,
                country,
                currency }, (timezone ? { timezone } : {})), (language ? { language } : {})), { contact: { email } }));
            const hashed = yield bcrypt_1.default.hash(String(password), SALT_ROUNDS);
            const owner = yield hubUserModel_1.default.create({
                hub_id: hub._id,
                name: name || hubName,
                email,
                password: hashed,
                role: "HUB_OWNER",
            });
            const token = (0, auth_1.signHubToken)({
                userId: String(owner._id),
                email: owner.email,
                hubId: String(hub._id),
                role: owner.role,
                businessId: null,
            });
            const safeUser = { _id: owner._id, name: owner.name, email: owner.email, role: owner.role };
            return res.status(201).json({
                status: true,
                statusCode: 201,
                message: "Hub creado correctamente",
                data: { hub, user: safeUser, token },
            });
        }
        catch (error) {
            console.error("Error en registro de hub:", error);
            return res.status(500).json({
                status: false,
                statusCode: 500,
                message: "Error interno del servidor",
                data: { error: error instanceof Error ? error.message : error },
            });
        }
    });
}
/**
 * POST /api/hub-users/login
 * Body: { email, password }
 * Funciona para TODOS los roles, incluido BUSINESS_VIEWER (Portal Business):
 * el token estampa hubId + role + businessId (si aplica).
 */
function loginHubUser(req, res) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            const { email, password } = req.body || {};
            if (!email || !password) {
                return res.status(400).json({
                    status: false,
                    statusCode: 400,
                    message: "email y password son requeridos",
                    data: {},
                });
            }
            const user = yield hubUserModel_1.default.findOne({ email: String(email).toLowerCase().trim() });
            if (!user || user.status !== "ACTIVE") {
                return res.status(401).json({
                    status: false,
                    statusCode: 401,
                    message: "Credenciales inválidas",
                    data: {},
                });
            }
            const ok = yield bcrypt_1.default.compare(String(password), user.password);
            if (!ok) {
                return res.status(401).json({
                    status: false,
                    statusCode: 401,
                    message: "Credenciales inválidas",
                    data: {},
                });
            }
            const hub = yield hubModel_1.default.findById(user.hub_id);
            if (!hub || hub.status !== "ACTIVE") {
                return res.status(403).json({
                    status: false,
                    statusCode: 403,
                    message: "El hub no está activo",
                    data: {},
                });
            }
            const token = (0, auth_1.signHubToken)({
                userId: String(user._id),
                email: user.email,
                hubId: String(user.hub_id),
                role: user.role,
                businessId: user.business_id || null,
            });
            const safeUser = {
                _id: user._id,
                name: user.name,
                email: user.email,
                role: user.role,
                business_id: user.business_id || null,
            };
            return res.status(200).json({
                status: true,
                statusCode: 200,
                message: "Sesión iniciada correctamente",
                data: { user: safeUser, hub, token },
            });
        }
        catch (error) {
            console.error("Error al iniciar sesión:", error);
            return res.status(500).json({
                status: false,
                statusCode: 500,
                message: "Error interno del servidor",
                data: { error: error instanceof Error ? error.message : error },
            });
        }
    });
}
/**
 * POST /api/hub-users  (HUB_OWNER/HUB_ADMIN)
 * Crea usuarios del hub. Para BUSINESS_VIEWER, businessId es obligatorio —
 * es el candado del Portal Business.
 */
function createHubUser(req, res) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            const ctx = req.hubContext;
            const { email, password, name, role, businessId } = req.body || {};
            const allowedRoles = ["HUB_ADMIN", "HUB_STAFF", "BUSINESS_VIEWER"];
            if (!email || !password || !role || !allowedRoles.includes(role)) {
                return res.status(400).json({
                    status: false,
                    statusCode: 400,
                    message: "email, password y role (HUB_ADMIN | HUB_STAFF | BUSINESS_VIEWER) son requeridos",
                    data: {},
                });
            }
            if (role === "BUSINESS_VIEWER" && !businessId) {
                return res.status(400).json({
                    status: false,
                    statusCode: 400,
                    message: "businessId es requerido para el rol BUSINESS_VIEWER",
                    data: {},
                });
            }
            const emailTaken = yield hubUserModel_1.default.exists({ email: String(email).toLowerCase().trim() });
            if (emailTaken) {
                return res.status(409).json({
                    status: false,
                    statusCode: 409,
                    message: "Ya existe un usuario con ese email.",
                    data: {},
                });
            }
            const hashed = yield bcrypt_1.default.hash(String(password), SALT_ROUNDS);
            const user = yield hubUserModel_1.default.create({
                hub_id: ctx.hubId,
                name,
                email,
                password: hashed,
                role,
                business_id: role === "BUSINESS_VIEWER" ? String(businessId) : null,
            });
            const safeUser = { _id: user._id, name: user.name, email: user.email, role: user.role, business_id: user.business_id };
            return res.status(201).json({
                status: true,
                statusCode: 201,
                message: "Usuario creado correctamente",
                data: { user: safeUser },
            });
        }
        catch (error) {
            console.error("Error creando usuario de hub:", error);
            return res.status(500).json({
                status: false,
                statusCode: 500,
                message: "Error interno del servidor",
                data: { error: error instanceof Error ? error.message : error },
            });
        }
    });
}
/** GET /api/hub-users  (HUB_OWNER/HUB_ADMIN) — usuarios del hub, sin hashes. */
function getHubUsers(req, res) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            const ctx = req.hubContext;
            const users = yield hubUserModel_1.default
                .find({ hub_id: ctx.hubId })
                .select("-password -password_reset_token_hash -password_reset_expires_at")
                .sort({ created_at: -1 });
            return res.status(200).json({
                status: true,
                statusCode: 200,
                message: "Usuarios del hub",
                data: { users },
            });
        }
        catch (error) {
            console.error("Error listando usuarios de hub:", error);
            return res.status(500).json({
                status: false,
                statusCode: 500,
                message: "Error interno del servidor",
                data: { error: error instanceof Error ? error.message : error },
            });
        }
    });
}
/** DELETE /api/hub-users/:id  (HUB_OWNER/HUB_ADMIN) — nunca al último OWNER. */
function deleteHubUser(req, res) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            const ctx = req.hubContext;
            const { id } = req.params;
            const user = yield hubUserModel_1.default.findOne({ _id: id, hub_id: ctx.hubId });
            if (!user) {
                return res.status(404).json({
                    status: false,
                    statusCode: 404,
                    message: "Usuario no encontrado",
                    data: {},
                });
            }
            if (user.role === "HUB_OWNER") {
                const owners = yield hubUserModel_1.default.countDocuments({ hub_id: ctx.hubId, role: "HUB_OWNER" });
                if (owners <= 1) {
                    return res.status(400).json({
                        status: false,
                        statusCode: 400,
                        message: "No puedes eliminar al último propietario del hub",
                        data: {},
                    });
                }
            }
            yield hubUserModel_1.default.deleteOne({ _id: id, hub_id: ctx.hubId });
            return res.status(200).json({
                status: true,
                statusCode: 200,
                message: "Usuario eliminado",
                data: {},
            });
        }
        catch (error) {
            console.error("Error eliminando usuario de hub:", error);
            return res.status(500).json({
                status: false,
                statusCode: 500,
                message: "Error interno del servidor",
                data: { error: error instanceof Error ? error.message : error },
            });
        }
    });
}
