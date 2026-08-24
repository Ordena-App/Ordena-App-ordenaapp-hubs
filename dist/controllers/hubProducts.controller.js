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
Object.defineProperty(exports, "__esModule", { value: true });
exports.getMyBusinessProducts = getMyBusinessProducts;
exports.createMyBusinessProduct = createMyBusinessProduct;
exports.updateMyBusinessProduct = updateMyBusinessProduct;
exports.deleteMyBusinessProduct = deleteMyBusinessProduct;
exports.setMyProductHubCategories = setMyProductHubCategories;
const businessService_external_1 = require("../services/businessService.external");
const productsService_external_1 = require("../services/productsService.external");
// Gestión de productos de los negocios del hub (F2.1). Regla de oro intacta:
// TODA operación valida pertenencia hub→negocio antes de tocar products.
function upstreamError(res, error, action) {
    var _a, _b, _c;
    if ((error === null || error === void 0 ? void 0 : error.code) === "BUSINESS_NOT_IN_HUB") {
        return res.status(403).json({
            status: false,
            statusCode: 403,
            message: "El negocio no pertenece a este hub",
            data: {},
        });
    }
    const upstreamStatus = (_a = error === null || error === void 0 ? void 0 : error.response) === null || _a === void 0 ? void 0 : _a.status;
    // 4xx del upstream traen validaciones útiles (límites, precio inválido…)
    if (upstreamStatus && upstreamStatus >= 400 && upstreamStatus < 500 && ((_b = error === null || error === void 0 ? void 0 : error.response) === null || _b === void 0 ? void 0 : _b.data)) {
        return res.status(upstreamStatus).json(error.response.data);
    }
    console.error(`Error en ${action}:`, ((_c = error === null || error === void 0 ? void 0 : error.response) === null || _c === void 0 ? void 0 : _c.data) || (error === null || error === void 0 ? void 0 : error.message) || error);
    return res.status(502).json({
        status: false,
        statusCode: 502,
        message: `No se pudo ${action} (products-service respondió ${upstreamStatus !== null && upstreamStatus !== void 0 ? upstreamStatus : "sin conexión"})`,
        data: {},
    });
}
/** GET /api/hubs/me/businesses/:businessId/products?page=&limit=&name= */
function getMyBusinessProducts(req, res) {
    return __awaiter(this, void 0, void 0, function* () {
        const ctx = req.hubContext;
        try {
            const businessId = String(req.params.businessId);
            yield (0, businessService_external_1.assertBusinessBelongsToHub)(ctx.hubId, businessId);
            const resp = yield (0, productsService_external_1.listBusinessProducts)(businessId, {
                page: Number(req.query.page) || 1,
                limit: Number(req.query.limit) || 50,
                name: typeof req.query.name === "string" ? req.query.name : undefined,
            });
            return res.status(200).json(resp);
        }
        catch (error) {
            return upstreamError(res, error, "listar los productos");
        }
    });
}
// Campos que el hub puede definir al crear/editar. Variantes, combinaciones,
// promociones y demás avanzado quedan para el editor completo (post-MVP).
const CREATE_FIELDS = ["name", "price", "stock", "description", "sku", "track_stock"];
const UPDATE_FIELDS = ["name", "price", "stock", "description", "sku", "track_stock", "isActive"];
/** POST /api/hubs/me/businesses/:businessId/products (multipart: hasta 4 'images' opcionales) */
function createMyBusinessProduct(req, res) {
    return __awaiter(this, void 0, void 0, function* () {
        const ctx = req.hubContext;
        try {
            const businessId = String(req.params.businessId);
            yield (0, businessService_external_1.assertBusinessBelongsToHub)(ctx.hubId, businessId);
            const fields = {};
            for (const f of CREATE_FIELDS) {
                if (req.body && req.body[f] !== undefined && req.body[f] !== "")
                    fields[f] = req.body[f];
            }
            if (!fields.name || fields.price === undefined) {
                return res.status(400).json({
                    status: false,
                    statusCode: 400,
                    message: "name y price son requeridos",
                    data: {},
                });
            }
            // Si maneja stock, activar el tracking para que el storefront lo respete
            if (fields.stock !== undefined && fields.track_stock === undefined) {
                fields.track_stock = "true";
            }
            const files = Array.isArray(req.files)
                ? req.files
                : [];
            const resp = yield (0, productsService_external_1.createBusinessProduct)(businessId, fields, files);
            return res.status(201).json(resp);
        }
        catch (error) {
            return upstreamError(res, error, "crear el producto");
        }
    });
}
/** PATCH /api/hubs/me/businesses/:businessId/products/:productId */
function updateMyBusinessProduct(req, res) {
    return __awaiter(this, void 0, void 0, function* () {
        const ctx = req.hubContext;
        try {
            const businessId = String(req.params.businessId);
            const productId = String(req.params.productId);
            yield (0, businessService_external_1.assertBusinessBelongsToHub)(ctx.hubId, businessId);
            const patch = {};
            for (const f of UPDATE_FIELDS) {
                if (req.body && req.body[f] !== undefined)
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
            const resp = yield (0, productsService_external_1.updateBusinessProduct)(businessId, productId, patch);
            return res.status(200).json(resp);
        }
        catch (error) {
            return upstreamError(res, error, "actualizar el producto");
        }
    });
}
/** DELETE /api/hubs/me/businesses/:businessId/products/:productId */
function deleteMyBusinessProduct(req, res) {
    return __awaiter(this, void 0, void 0, function* () {
        const ctx = req.hubContext;
        try {
            const businessId = String(req.params.businessId);
            const productId = String(req.params.productId);
            yield (0, businessService_external_1.assertBusinessBelongsToHub)(ctx.hubId, businessId);
            const resp = yield (0, productsService_external_1.deleteBusinessProduct)(businessId, productId);
            return res.status(200).json(resp);
        }
        catch (error) {
            return upstreamError(res, error, "eliminar el producto");
        }
    });
}
/** PATCH /api/hubs/me/products/:productId/hub-categories  Body: { hubCategoryIds: string[] } */
function setMyProductHubCategories(req, res) {
    return __awaiter(this, void 0, void 0, function* () {
        const ctx = req.hubContext;
        try {
            const productId = String(req.params.productId);
            const raw = (req.body || {}).hubCategoryIds;
            if (!Array.isArray(raw)) {
                return res.status(400).json({
                    status: false,
                    statusCode: 400,
                    message: "hubCategoryIds debe ser un array",
                    data: {},
                });
            }
            // products re-valida producto→negocio→hub con ctx.hubId (defensa en profundidad)
            const resp = yield (0, productsService_external_1.setProductHubCategoriesExternal)(ctx.hubId, productId, raw.map(String));
            return res.status(200).json(resp);
        }
        catch (error) {
            return upstreamError(res, error, "asignar las categorías");
        }
    });
}
