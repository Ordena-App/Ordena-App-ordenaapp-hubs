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
exports.getMyHubCategories = getMyHubCategories;
exports.createHubCategory = createHubCategory;
exports.updateHubCategory = updateHubCategory;
exports.deleteHubCategory = deleteHubCategory;
const hubCategoryModel_1 = __importDefault(require("../models/hubCategoryModel"));
const slug_1 = require("../utils/slug");
/** GET /api/hubs/me/categories — todas (activas e inactivas) para administración. */
function getMyHubCategories(req, res) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            const ctx = req.hubContext;
            const categories = yield hubCategoryModel_1.default
                .find({ hub_id: ctx.hubId })
                .sort({ sort_order: 1, name: 1 });
            return res.status(200).json({
                status: true,
                statusCode: 200,
                message: "Categorías del hub",
                data: { categories },
            });
        }
        catch (error) {
            console.error("Error listando categorías:", error);
            return res.status(500).json({
                status: false,
                statusCode: 500,
                message: "Error interno del servidor",
                data: { error: error instanceof Error ? error.message : error },
            });
        }
    });
}
/** POST /api/hubs/me/categories  (HUB_OWNER/HUB_ADMIN) */
function createHubCategory(req, res) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            const ctx = req.hubContext;
            const { name, description, image_url, sort_order } = req.body || {};
            if (!name) {
                return res.status(400).json({
                    status: false,
                    statusCode: 400,
                    message: "name es requerido",
                    data: {},
                });
            }
            const slug = (0, slug_1.normalizeSlug)(name);
            const exists = yield hubCategoryModel_1.default.exists({ hub_id: ctx.hubId, slug });
            if (exists) {
                return res.status(409).json({
                    status: false,
                    statusCode: 409,
                    message: "Ya existe una categoría con ese nombre",
                    data: { slug },
                });
            }
            const category = yield hubCategoryModel_1.default.create({
                hub_id: ctx.hubId,
                name,
                slug,
                description,
                image_url,
                sort_order: typeof sort_order === "number" ? sort_order : 0,
            });
            return res.status(201).json({
                status: true,
                statusCode: 201,
                message: "Categoría creada",
                data: { category },
            });
        }
        catch (error) {
            console.error("Error creando categoría:", error);
            return res.status(500).json({
                status: false,
                statusCode: 500,
                message: "Error interno del servidor",
                data: { error: error instanceof Error ? error.message : error },
            });
        }
    });
}
/** PUT /api/hubs/me/categories/:id  (HUB_OWNER/HUB_ADMIN) */
function updateHubCategory(req, res) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            const ctx = req.hubContext;
            const { id } = req.params;
            const { name, description, image_url, sort_order, isActive } = req.body || {};
            const patch = { updated_at: new Date() };
            if (name !== undefined) {
                patch["name"] = name;
                patch["slug"] = (0, slug_1.normalizeSlug)(String(name));
            }
            if (description !== undefined)
                patch["description"] = description;
            if (image_url !== undefined)
                patch["image_url"] = image_url;
            if (typeof sort_order === "number")
                patch["sort_order"] = sort_order;
            if (typeof isActive === "boolean")
                patch["isActive"] = isActive;
            const category = yield hubCategoryModel_1.default.findOneAndUpdate({ _id: id, hub_id: ctx.hubId }, { $set: patch }, { new: true });
            if (!category) {
                return res.status(404).json({
                    status: false,
                    statusCode: 404,
                    message: "Categoría no encontrada",
                    data: {},
                });
            }
            return res.status(200).json({
                status: true,
                statusCode: 200,
                message: "Categoría actualizada",
                data: { category },
            });
        }
        catch (error) {
            console.error("Error actualizando categoría:", error);
            return res.status(500).json({
                status: false,
                statusCode: 500,
                message: "Error interno del servidor",
                data: { error: error instanceof Error ? error.message : error },
            });
        }
    });
}
/** DELETE /api/hubs/me/categories/:id  (HUB_OWNER/HUB_ADMIN) */
function deleteHubCategory(req, res) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            const ctx = req.hubContext;
            const { id } = req.params;
            const result = yield hubCategoryModel_1.default.deleteOne({ _id: id, hub_id: ctx.hubId });
            if (result.deletedCount === 0) {
                return res.status(404).json({
                    status: false,
                    statusCode: 404,
                    message: "Categoría no encontrada",
                    data: {},
                });
            }
            // Nota: products-service mantiene product.hubCategoryIds; la limpieza de
            // referencias colgantes se resuelve allá (las IDs inexistentes simplemente
            // no matchean en las búsquedas del storefront).
            return res.status(200).json({
                status: true,
                statusCode: 200,
                message: "Categoría eliminada",
                data: {},
            });
        }
        catch (error) {
            console.error("Error eliminando categoría:", error);
            return res.status(500).json({
                status: false,
                statusCode: 500,
                message: "Error interno del servidor",
                data: { error: error instanceof Error ? error.message : error },
            });
        }
    });
}
