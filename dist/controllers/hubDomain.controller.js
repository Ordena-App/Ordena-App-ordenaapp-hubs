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
exports.setMyHubDomain = setMyHubDomain;
exports.refreshMyHubDomainStatus = refreshMyHubDomainStatus;
exports.clearMyHubDomain = clearMyHubDomain;
exports.resolveHubByDomain = resolveHubByDomain;
const hubModel_1 = __importDefault(require("../models/hubModel"));
const hubCategoryModel_1 = __importDefault(require("../models/hubCategoryModel"));
const businessService_external_1 = require("../services/businessService.external");
/**
 * Dominio custom del hub (F4): oeya.com en vez de oe-ya.ordena.app.
 * Vercel se opera vía los proxies internos de business (un solo dueño del
 * token de infraestructura); el ESTADO vive aquí, en hub.domain.
 */
const DOMAIN_RE = /^(?=.{4,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/;
function normalizeHost(raw) {
    return String(raw || "")
        .trim()
        .toLowerCase()
        .replace(/^https?:\/\//, "")
        .replace(/\/.*$/, "")
        .replace(/:\d+$/, "");
}
/** POST /api/hubs/me/domain  (HUB_OWNER)  Body: { domain } */
function setMyHubDomain(req, res) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b, _c, _d;
        const ctx = req.hubContext;
        try {
            const domain = normalizeHost(String(((_a = req.body) === null || _a === void 0 ? void 0 : _a.domain) || ""));
            if (!DOMAIN_RE.test(domain)) {
                return res.status(400).json({ status: false, statusCode: 400, message: "Dominio inválido", data: {} });
            }
            // Los hosts de la plataforma no son dominios custom de nadie.
            if (domain.endsWith(".ordena.app") || domain === "ordena.app" || domain.endsWith(".localhost")) {
                return res.status(400).json({ status: false, statusCode: 400, message: "Ese dominio pertenece a la plataforma", data: {} });
            }
            // Un dominio no puede apuntar a dos hubs.
            const taken = yield hubModel_1.default.exists({
                _id: { $ne: ctx.hubId },
                $or: [{ "domain.requestedDomain": domain }, { "domain.verifiedDomain": domain }],
            });
            if (taken) {
                return res.status(409).json({ status: false, statusCode: 409, message: "Ese dominio ya está en uso por otro hub", data: {} });
            }
            yield (0, businessService_external_1.addHubDomainExternal)(domain);
            yield hubModel_1.default.updateOne({ _id: ctx.hubId }, {
                $set: {
                    "domain.requestedDomain": domain,
                    "domain.verifiedDomain": null,
                    "domain.sslEnabled": false,
                    "domain.status": "pending",
                    updated_at: new Date(),
                },
            });
            return res.status(200).json({
                status: true,
                statusCode: 200,
                message: "Dominio configurado. Apunta tu DNS y verifica el estado.",
                data: {
                    domain: { requestedDomain: domain, status: "pending", sslEnabled: false },
                    // Instrucciones DNS estándar de Vercel (mismas del flujo white-label)
                    dns: {
                        apex: { type: "A", name: "@", value: "76.76.21.21" },
                        subdomain: { type: "CNAME", name: "www", value: "cname.vercel-dns.com" },
                    },
                },
            });
        }
        catch (error) {
            const st = (_b = error === null || error === void 0 ? void 0 : error.response) === null || _b === void 0 ? void 0 : _b.status;
            if (st && st >= 400 && st < 500 && ((_c = error === null || error === void 0 ? void 0 : error.response) === null || _c === void 0 ? void 0 : _c.data)) {
                return res.status(st).json(error.response.data);
            }
            console.error("Error configurando dominio del hub:", ((_d = error === null || error === void 0 ? void 0 : error.response) === null || _d === void 0 ? void 0 : _d.data) || (error === null || error === void 0 ? void 0 : error.message) || error);
            return res.status(502).json({ status: false, statusCode: 502, message: "No se pudo configurar el dominio", data: {} });
        }
    });
}
/** GET /api/hubs/me/domain/status  (HUB_OWNER / HUB_ADMIN) — consulta Vercel y sella. */
function refreshMyHubDomainStatus(req, res) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b, _c, _d;
        const ctx = req.hubContext;
        try {
            const hub = yield hubModel_1.default.findById(ctx.hubId).select("domain").lean();
            const requested = (_a = hub === null || hub === void 0 ? void 0 : hub.domain) === null || _a === void 0 ? void 0 : _a.requestedDomain;
            if (!requested) {
                return res.status(400).json({ status: false, statusCode: 400, message: "El hub no tiene un dominio configurado", data: {} });
            }
            const resp = yield (0, businessService_external_1.hubDomainStatusExternal)(requested);
            const status = ((_b = resp === null || resp === void 0 ? void 0 : resp.data) === null || _b === void 0 ? void 0 : _b.status) || "pending";
            const sslEnabled = !!((_c = resp === null || resp === void 0 ? void 0 : resp.data) === null || _c === void 0 ? void 0 : _c.sslEnabled);
            const set = {
                "domain.status": status === "verified" ? "verified" : status === "error" ? "error" : "pending",
                "domain.sslEnabled": sslEnabled,
                updated_at: new Date(),
            };
            if (status === "verified")
                set["domain.verifiedDomain"] = requested;
            yield hubModel_1.default.updateOne({ _id: ctx.hubId }, { $set: set });
            return res.status(200).json({
                status: true,
                statusCode: 200,
                message: status === "verified" ? "Dominio verificado" : "Dominio aún pendiente de verificación",
                data: { domain: { requestedDomain: requested, verifiedDomain: status === "verified" ? requested : null, status: set["domain.status"], sslEnabled } },
            });
        }
        catch (error) {
            console.error("Error verificando dominio del hub:", ((_d = error === null || error === void 0 ? void 0 : error.response) === null || _d === void 0 ? void 0 : _d.data) || (error === null || error === void 0 ? void 0 : error.message) || error);
            return res.status(502).json({ status: false, statusCode: 502, message: "No se pudo verificar el dominio", data: {} });
        }
    });
}
/** DELETE /api/hubs/me/domain  (HUB_OWNER) — desconecta (el DNS del cliente deja de servir). */
function clearMyHubDomain(req, res) {
    return __awaiter(this, void 0, void 0, function* () {
        const ctx = req.hubContext;
        try {
            yield hubModel_1.default.updateOne({ _id: ctx.hubId }, {
                $set: {
                    "domain.requestedDomain": null,
                    "domain.verifiedDomain": null,
                    "domain.sslEnabled": false,
                    "domain.status": "unconfigured",
                    updated_at: new Date(),
                },
            });
            return res.status(200).json({ status: true, statusCode: 200, message: "Dominio desconectado", data: {} });
        }
        catch (error) {
            console.error("Error desconectando dominio del hub:", error);
            return res.status(500).json({ status: false, statusCode: 500, message: "Error interno del servidor", data: {} });
        }
    });
}
/**
 * GET /api/hubs/resolve-by-domain?host=oeya.com  (PÚBLICO)
 * Espejo de /resolve pero por dominio VERIFICADO. Lo consume el middleware del
 * frontend (host desconocido que no es tenant WL) y el gateway (CORS). Misma
 * proyección pública que /resolve — nada interno.
 */
function resolveHubByDomain(req, res) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            const host = normalizeHost(String(req.query.host || ""));
            if (!host) {
                return res.status(400).json({ status: false, statusCode: 400, message: "host es requerido", data: {} });
            }
            // www.oeya.com y oeya.com resuelven al mismo hub.
            const bare = host.replace(/^www\./, "");
            const hub = yield hubModel_1.default
                .findOne({
                "domain.status": "verified",
                "domain.verifiedDomain": { $in: [host, bare, `www.${bare}`] },
                status: "ACTIVE",
            })
                .select("name slug description logo favicon branding " +
                "contact.whatsapp contact.instagram contact.facebook contact.tiktok contact.website " +
                "timezone country currency language domain status");
            if (!hub) {
                return res.status(404).json({ status: false, statusCode: 404, message: "Hub no encontrado", data: {} });
            }
            const categories = yield hubCategoryModel_1.default
                .find({ hub_id: hub._id, isActive: true })
                .select("name slug image_url sort_order")
                .sort({ sort_order: 1, name: 1 });
            return res.status(200).json({
                status: true,
                statusCode: 200,
                message: "Hub resuelto",
                data: { hub, categories },
            });
        }
        catch (error) {
            console.error("Error en resolve-by-domain:", error);
            return res.status(500).json({ status: false, statusCode: 500, message: "Error interno del servidor", data: {} });
        }
    });
}
