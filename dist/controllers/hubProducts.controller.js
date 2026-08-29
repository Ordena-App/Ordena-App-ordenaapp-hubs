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
exports.getMyBusinessCategories = getMyBusinessCategories;
exports.getMyBusinessPackageTemplates = getMyBusinessPackageTemplates;
exports.getMyBusinessProviders = getMyBusinessProviders;
exports.createMyBusinessProvider = createMyBusinessProvider;
exports.createMyBusinessCategory = createMyBusinessCategory;
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
/**
 * Candado extra: el producto DEBE pertenecer al negocio indicado. products ya
 * acota sus mutaciones por x-business-id, pero validar aquí evita depender de
 * una sola capa y devuelve un 403 claro en vez de un 404 confuso.
 */
function assertProductBelongsToBusiness(businessId, productId) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b, _c, _d, _e, _f, _g;
        let product = null;
        try {
            const resp = yield (0, productsService_external_1.getProductByIdExternal)(businessId, productId);
            product = (_e = (_d = (_c = (_b = (_a = resp === null || resp === void 0 ? void 0 : resp.data) === null || _a === void 0 ? void 0 : _a.product) !== null && _b !== void 0 ? _b : resp === null || resp === void 0 ? void 0 : resp.data) !== null && _c !== void 0 ? _c : resp === null || resp === void 0 ? void 0 : resp.product) !== null && _d !== void 0 ? _d : resp) !== null && _e !== void 0 ? _e : null;
        }
        catch (_h) {
            product = null;
        }
        const ownerId = product && ((_f = product.businessId) !== null && _f !== void 0 ? _f : (_g = product === null || product === void 0 ? void 0 : product.data) === null || _g === void 0 ? void 0 : _g.businessId);
        if (!ownerId || String(ownerId) !== String(businessId)) {
            const err = new Error("product_not_in_business");
            err.response = {
                status: 403,
                data: { status: false, statusCode: 403, message: "El producto no pertenece a este negocio", data: {} },
            };
            throw err;
        }
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
// Editor 1:1 con el dashboard clásico: el body pasa COMPLETO al upstream
// (variantes, combinaciones, packaging, price_tiers, SEO, promociones…).
// Solo se excluyen los campos de control del tenant: businessId lo fuerza el
// proxy y hubCategoryIds tiene su propio endpoint interno con validación.
const BLOCKED_FIELDS = new Set(["businessId", "hubId", "hubCategoryIds", "hub_id"]);
function passThroughBody(body) {
    const out = {};
    if (!body)
        return out;
    for (const [key, value] of Object.entries(body)) {
        if (BLOCKED_FIELDS.has(key))
            continue;
        if (value !== undefined)
            out[key] = value;
    }
    return out;
}
/** POST /api/hubs/me/businesses/:businessId/products (multipart: hasta 4 'images' opcionales) */
function createMyBusinessProduct(req, res) {
    return __awaiter(this, void 0, void 0, function* () {
        const ctx = req.hubContext;
        try {
            const businessId = String(req.params.businessId);
            yield (0, businessService_external_1.assertBusinessBelongsToHub)(ctx.hubId, businessId);
            const fields = passThroughBody(req.body);
            if (!fields.name || fields.price === undefined) {
                return res.status(400).json({
                    status: false,
                    statusCode: 400,
                    message: "name y price son requeridos",
                    data: {},
                });
            }
            // track_stock SIEMPRE explícito: con stock => se controla inventario;
            // sin stock => ilimitado. (products default a true + stock 0 = producto
            // agotado desde su creación, que es lo contrario de "Stock (opcional)".)
            if (fields.track_stock === undefined) {
                fields.track_stock = fields.stock !== undefined ? "true" : "false";
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
            yield assertProductBelongsToBusiness(businessId, productId);
            const patch = passThroughBody(req.body);
            const files = Array.isArray(req.files)
                ? req.files
                : [];
            if (Object.keys(patch).length === 0 && files.length === 0) {
                return res.status(400).json({
                    status: false,
                    statusCode: 400,
                    message: "Nada que actualizar",
                    data: {},
                });
            }
            const resp = yield (0, productsService_external_1.updateBusinessProduct)(businessId, productId, patch, files);
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
            yield assertProductBelongsToBusiness(businessId, productId);
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
/**
 * GET /api/hubs/me/businesses/:businessId/categories
 * Categorías internas del negocio (para asignarlas al crear/editar productos
 * desde el hub — mismas categorías que usa el storefront clásico del negocio).
 */
function getMyBusinessCategories(req, res) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a;
        const ctx = req.hubContext;
        try {
            const businessId = String(req.params.businessId);
            yield (0, businessService_external_1.assertBusinessBelongsToHub)(ctx.hubId, businessId);
            const categories = yield (0, productsService_external_1.listBusinessCategoriesExternal)(businessId);
            return res.status(200).json({
                status: true,
                statusCode: 200,
                message: "Categorías del negocio",
                data: { categories },
            });
        }
        catch (error) {
            if ((error === null || error === void 0 ? void 0 : error.code) === "BUSINESS_NOT_IN_HUB") {
                return res.status(403).json({ status: false, statusCode: 403, message: "El negocio no pertenece a este hub", data: {} });
            }
            console.error("Error listando categorías del negocio:", ((_a = error === null || error === void 0 ? void 0 : error.response) === null || _a === void 0 ? void 0 : _a.data) || (error === null || error === void 0 ? void 0 : error.message) || error);
            return res.status(502).json({ status: false, statusCode: 502, message: "No se pudieron cargar las categorías", data: {} });
        }
    });
}
// ── Editor 1:1: recursos auxiliares del negocio (respuesta upstream VERBATIM) ──
/** GET /api/hubs/me/businesses/:businessId/package-templates */
function getMyBusinessPackageTemplates(req, res) {
    return __awaiter(this, void 0, void 0, function* () {
        const ctx = req.hubContext;
        try {
            const businessId = String(req.params.businessId);
            yield (0, businessService_external_1.assertBusinessBelongsToHub)(ctx.hubId, businessId);
            const data = yield (0, productsService_external_1.listPackageTemplatesExternal)(businessId);
            return res.status(200).json(data);
        }
        catch (error) {
            return upstreamError(res, error, "cargar las plantillas de empaque");
        }
    });
}
/** GET /api/hubs/me/businesses/:businessId/providers */
function getMyBusinessProviders(req, res) {
    return __awaiter(this, void 0, void 0, function* () {
        const ctx = req.hubContext;
        try {
            const businessId = String(req.params.businessId);
            yield (0, businessService_external_1.assertBusinessBelongsToHub)(ctx.hubId, businessId);
            const data = yield (0, productsService_external_1.listBusinessProvidersExternal)(businessId);
            return res.status(200).json(data);
        }
        catch (error) {
            return upstreamError(res, error, "cargar los proveedores");
        }
    });
}
/** POST /api/hubs/me/businesses/:businessId/providers */
function createMyBusinessProvider(req, res) {
    return __awaiter(this, void 0, void 0, function* () {
        const ctx = req.hubContext;
        try {
            const businessId = String(req.params.businessId);
            yield (0, businessService_external_1.assertBusinessBelongsToHub)(ctx.hubId, businessId);
            const data = yield (0, productsService_external_1.createBusinessProviderExternal)(businessId, passThroughBody(req.body));
            return res.status(201).json(data);
        }
        catch (error) {
            return upstreamError(res, error, "crear el proveedor");
        }
    });
}
/** POST /api/hubs/me/businesses/:businessId/categories (multipart: 'image' opcional) */
function createMyBusinessCategory(req, res) {
    return __awaiter(this, void 0, void 0, function* () {
        const ctx = req.hubContext;
        try {
            const businessId = String(req.params.businessId);
            yield (0, businessService_external_1.assertBusinessBelongsToHub)(ctx.hubId, businessId);
            const files = Array.isArray(req.files)
                ? req.files
                : [];
            const data = yield (0, productsService_external_1.createBusinessCategoryExternal)(businessId, passThroughBody(req.body), files);
            return res.status(201).json(data);
        }
        catch (error) {
            return upstreamError(res, error, "crear la categoría");
        }
    });
}
