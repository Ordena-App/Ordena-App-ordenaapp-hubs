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
exports.resolveHubBySlug = resolveHubBySlug;
exports.getMyHub = getMyHub;
exports.updateMyHub = updateMyHub;
const hubModel_1 = __importDefault(require("../models/hubModel"));
const hubCategoryModel_1 = __importDefault(require("../models/hubCategoryModel"));
/**
 * GET /api/hubs/resolve?slug=oe-ya
 * PÚBLICO — lo consumen el middleware del frontend y el storefront del hub
 * para resolver {slug}.ordena.app. Devuelve solo información pública.
 */
function resolveHubBySlug(req, res) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            const slug = String(req.query.slug || "").trim().toLowerCase();
            if (!slug) {
                return res.status(400).json({
                    status: false,
                    statusCode: 400,
                    message: "slug es requerido",
                    data: {},
                });
            }
            const hub = yield hubModel_1.default
                .findOne({ slug, status: "ACTIVE" })
                .select("name slug description logo favicon branding contact timezone country currency language domain status");
            if (!hub) {
                return res.status(404).json({
                    status: false,
                    statusCode: 404,
                    message: "Hub no encontrado",
                    data: {},
                });
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
            console.error("Error resolviendo hub:", error);
            return res.status(500).json({
                status: false,
                statusCode: 500,
                message: "Error interno del servidor",
                data: { error: error instanceof Error ? error.message : error },
            });
        }
    });
}
/** GET /api/hubs/me — hub del usuario autenticado. */
function getMyHub(req, res) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            const ctx = req.hubContext;
            const hub = yield hubModel_1.default.findById(ctx.hubId);
            if (!hub) {
                return res.status(404).json({
                    status: false,
                    statusCode: 404,
                    message: "Hub no encontrado",
                    data: {},
                });
            }
            return res.status(200).json({
                status: true,
                statusCode: 200,
                message: "Hub",
                data: { hub },
            });
        }
        catch (error) {
            console.error("Error obteniendo hub:", error);
            return res.status(500).json({
                status: false,
                statusCode: 500,
                message: "Error interno del servidor",
                data: { error: error instanceof Error ? error.message : error },
            });
        }
    });
}
// Campos editables por el hub. El slug NO se edita aquí (cambiarlo rompe la
// URL pública; será un flujo aparte con validaciones cuando se necesite).
const UPDATABLE_FIELDS = [
    "name",
    "description",
    "logo",
    "favicon",
    "branding",
    "contact",
    "timezone",
    "language",
    "businessVisibility",
];
/** PUT /api/hubs/me  (HUB_OWNER/HUB_ADMIN) */
function updateMyHub(req, res) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            const ctx = req.hubContext;
            const patch = {};
            for (const field of UPDATABLE_FIELDS) {
                if (req.body && req.body[field] !== undefined)
                    patch[field] = req.body[field];
            }
            if (Object.keys(patch).length === 0) {
                return res.status(400).json({
                    status: false,
                    statusCode: 400,
                    message: "Nada que actualizar",
                    data: {},
                });
            }
            patch["updated_at"] = new Date();
            const hub = yield hubModel_1.default.findByIdAndUpdate(ctx.hubId, { $set: patch }, { new: true });
            return res.status(200).json({
                status: true,
                statusCode: 200,
                message: "Hub actualizado",
                data: { hub },
            });
        }
        catch (error) {
            console.error("Error actualizando hub:", error);
            return res.status(500).json({
                status: false,
                statusCode: 500,
                message: "Error interno del servidor",
                data: { error: error instanceof Error ? error.message : error },
            });
        }
    });
}
