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
        if (files.length === 0) {
            // Sin imágenes: JSON directo (multer del upstream ignora bodies no-multipart)
            const { data } = yield axios_1.default.post(url, Object.assign(Object.assign({}, fields), { businessId }), cfg);
            return data;
        }
        // Con imágenes: FormData nativo de Node (>=18) — axios setea el boundary.
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
function updateBusinessProduct(businessId, productId, patch) {
    return __awaiter(this, void 0, void 0, function* () {
        const { data } = yield axios_1.default.patch(`${config_1.PRODUCTS_SERVICE_LINK}/product/${productId}`, patch, { timeout: 15000, headers: headers(businessId) });
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
