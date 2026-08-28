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
exports.listBusinessProducts = listBusinessProducts;
exports.getProductByIdExternal = getProductByIdExternal;
exports.createBusinessProduct = createBusinessProduct;
exports.updateBusinessProduct = updateBusinessProduct;
exports.deleteBusinessProduct = deleteBusinessProduct;
exports.setProductHubCategoriesExternal = setProductHubCategoriesExternal;
exports.listBusinessCategoriesExternal = listBusinessCategoriesExternal;
exports.listPackageTemplatesExternal = listPackageTemplatesExternal;
exports.listBusinessProvidersExternal = listBusinessProvidersExternal;
exports.createBusinessProviderExternal = createBusinessProviderExternal;
exports.createBusinessCategoryExternal = createBusinessCategoryExternal;
const axios_1 = __importDefault(require("axios"));
const buffer_1 = require("buffer");
const config_1 = require("../config/config");
// Server-to-server hacia products-service para la gestión de productos de los
// negocios del hub (F2.1 — cierra el gap: los negocios hub no tienen login
// Firebase, así que el hub administra sus productos desde /hub-admin).
//
// products-service exige el header x-business-id (presencia) y aplica sus
// propios gates de plan (skusLimit permisivo -1 en negocios hub). La
// pertenencia hub→negocio la valida el CONTROLLER de hubs antes de llamar.
function headers(businessId) {
    return { "x-business-id": businessId };
}
function listBusinessProducts(businessId, params) {
    return __awaiter(this, void 0, void 0, function* () {
        const { data } = yield axios_1.default.get(`${config_1.PRODUCTS_SERVICE_LINK}/productbusiness-admin/${businessId}`, { params, timeout: 15000, headers: headers(businessId) });
        return data;
    });
}
/** Lee un producto por id (para validar su pertenencia al negocio). */
function getProductByIdExternal(businessId, productId) {
    return __awaiter(this, void 0, void 0, function* () {
        const { data } = yield axios_1.default.get(`${config_1.PRODUCTS_SERVICE_LINK}/product/${productId}`, {
            timeout: 15000,
            headers: headers(businessId),
        });
        return data;
    });
}
function createBusinessProduct(businessId, fields, files) {
    return __awaiter(this, void 0, void 0, function* () {
        const url = `${config_1.PRODUCTS_SERVICE_LINK}/product`;
        const cfg = { timeout: 30000, headers: headers(businessId) };
        // SIEMPRE multipart: es la única ruta que el dashboard clásico ejercita en
        // el upstream (multer + campos string). La variante JSON quedaba sin probar
        // y se comportaba distinto con los campos JSON-string (variants, options…).
        const FormDataCtor = globalThis.FormData;
        if (!FormDataCtor) {
            throw new Error("Node >= 18 requerido para subir imágenes (FormData nativo)");
        }
        const fd = new FormDataCtor();
        fd.append("businessId", businessId);
        for (const [key, value] of Object.entries(fields)) {
            if (value !== undefined && value !== null)
                fd.append(key, String(value));
        }
        for (const f of files) {
            // Cast: Buffer es ArrayBufferLike y el tipado estricto de Blob pide
            // ArrayBuffer exacto; en runtime es válido.
            fd.append("images", new buffer_1.Blob([f.buffer], { type: f.mimetype }), f.originalname);
        }
        const { data } = yield axios_1.default.post(url, fd, cfg);
        return data;
    });
}
function updateBusinessProduct(businessId_1, productId_1, patch_1) {
    return __awaiter(this, arguments, void 0, function* (businessId, productId, patch, files = []) {
        const url = `${config_1.PRODUCTS_SERVICE_LINK}/product/${productId}`;
        const cfg = { timeout: 30000, headers: headers(businessId) };
        // SIEMPRE multipart (misma razón que en create): paridad exacta con la
        // ruta del dashboard clásico. El upstream parsea los campos como strings.
        const FormDataCtor = globalThis.FormData;
        if (!FormDataCtor) {
            throw new Error("Node >= 18 requerido (FormData nativo)");
        }
        const fd = new FormDataCtor();
        for (const [key, value] of Object.entries(patch)) {
            if (value !== undefined && value !== null)
                fd.append(key, String(value));
        }
        for (const f of files) {
            fd.append("newImages", new buffer_1.Blob([f.buffer], { type: f.mimetype }), f.originalname);
        }
        const { data } = yield axios_1.default.patch(url, fd, cfg);
        return data;
    });
}
function deleteBusinessProduct(businessId, productId) {
    return __awaiter(this, void 0, void 0, function* () {
        const { data } = yield axios_1.default.delete(`${config_1.PRODUCTS_SERVICE_LINK}/product/${productId}`, { timeout: 15000, headers: headers(businessId) });
        return data;
    });
}
/**
 * Tagging de categorías globales. El endpoint interno de products re-valida la
 * cadena producto→negocio→hub (defensa en profundidad).
 */
function setProductHubCategoriesExternal(hubId, productId, hubCategoryIds) {
    return __awaiter(this, void 0, void 0, function* () {
        const { data } = yield axios_1.default.patch(`${config_1.PRODUCTS_SERVICE_LINK}/internal/hub/${hubId}/product/${productId}/hub-categories`, { hubCategoryIds }, {
            timeout: 15000,
            headers: config_1.INTERNAL_SHARED_SECRET ? { "x-ordena-secret": config_1.INTERNAL_SHARED_SECRET } : {},
        });
        return data;
    });
}
/** Categorías INTERNAS del negocio (colección category del ms products). */
function listBusinessCategoriesExternal(businessId) {
    return __awaiter(this, void 0, void 0, function* () {
        const { data } = yield axios_1.default.get(`${config_1.PRODUCTS_SERVICE_LINK}/categorybussiness/${businessId}`, {
            timeout: 15000,
            headers: headers(businessId),
        });
        // El upstream devuelve el array pelado (o {message} cuando no hay ninguna).
        return Array.isArray(data) ? data : [];
    });
}
// ── Editor 1:1 (paridad con el dashboard clásico) ──
// Estos proxies devuelven el cuerpo del upstream VERBATIM: el adaptador del
// frontend replica las mismas formas que las funciones de routes.ts del SaaS.
/** Plantillas de empaque del negocio (envíos). */
function listPackageTemplatesExternal(businessId) {
    return __awaiter(this, void 0, void 0, function* () {
        const { data } = yield axios_1.default.get(`${config_1.PRODUCTS_SERVICE_LINK}/package-templates`, {
            timeout: 15000,
            headers: headers(businessId),
            params: { businessId },
        });
        return data;
    });
}
/** Proveedores del negocio. */
function listBusinessProvidersExternal(businessId) {
    return __awaiter(this, void 0, void 0, function* () {
        const { data } = yield axios_1.default.get(`${config_1.PRODUCTS_SERVICE_LINK}/providerbusiness/${businessId}`, {
            timeout: 15000,
            headers: headers(businessId),
        });
        return data;
    });
}
/** Crear proveedor (JSON; el logo es opcional y el editor no lo manda). */
function createBusinessProviderExternal(businessId, body) {
    return __awaiter(this, void 0, void 0, function* () {
        const { data } = yield axios_1.default.post(`${config_1.PRODUCTS_SERVICE_LINK}/provider`, Object.assign(Object.assign({}, body), { businessId }), { timeout: 15000, headers: headers(businessId) });
        return data;
    });
}
/** Crear categoría interna del negocio (multipart: imagen opcional). */
function createBusinessCategoryExternal(businessId, fields, files) {
    return __awaiter(this, void 0, void 0, function* () {
        const url = `${config_1.PRODUCTS_SERVICE_LINK}/category`;
        const cfg = { timeout: 20000, headers: headers(businessId) };
        if (files.length === 0) {
            const { data } = yield axios_1.default.post(url, Object.assign(Object.assign({}, fields), { businessId }), cfg);
            return data;
        }
        const FormDataCtor = globalThis.FormData;
        const fd = new FormDataCtor();
        fd.append("businessId", businessId);
        for (const [key, value] of Object.entries(fields)) {
            if (value !== undefined && value !== null)
                fd.append(key, String(value));
        }
        for (const f of files) {
            fd.append("image", new buffer_1.Blob([f.buffer], { type: f.mimetype }), f.originalname);
        }
        const { data } = yield axios_1.default.post(url, fd, cfg);
        return data;
    });
}
