"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const multer_1 = __importDefault(require("multer"));
const hubProducts_controller_1 = require("../controllers/hubProducts.controller");
const auth_1 = require("../utils/auth");
// Imágenes en memoria: se re-envían a products-service, que las sube al bucket.
// Solo imágenes: evita que se suba y sirva contenido arbitrario desde el bucket.
const imageFileFilter = (_req, file, cb) => {
    if (/^image\/(jpeg|jpg|png|webp|gif|avif)$/i.test(file.mimetype))
        return cb(null, true);
    return cb(new Error("INVALID_FILE_TYPE"));
};
const upload = (0, multer_1.default)({
    storage: multer_1.default.memoryStorage(),
    limits: { fileSize: 8 * 1024 * 1024, files: 4 },
    fileFilter: imageFileFilter,
});
/** Traduce errores de multer (tamaño/tipo/cantidad) a 400 con mensaje claro. */
function uploadErrorHandler(err, _req, res, next) {
    var _a, _b;
    if (!err)
        return next();
    const isTooLarge = (err === null || err === void 0 ? void 0 : err.code) === "LIMIT_FILE_SIZE";
    const isBadType = (err === null || err === void 0 ? void 0 : err.message) === "INVALID_FILE_TYPE";
    if (isTooLarge || isBadType || ((_b = (_a = err === null || err === void 0 ? void 0 : err.code) === null || _a === void 0 ? void 0 : _a.startsWith) === null || _b === void 0 ? void 0 : _b.call(_a, "LIMIT_"))) {
        return res.status(400).json({
            status: false,
            statusCode: 400,
            message: isBadType
                ? "Formato no soportado. Sube imágenes JPG, PNG, WEBP o GIF."
                : isTooLarge
                    ? "La imagen supera el límite de 8 MB."
                    : "No se pudo procesar el archivo.",
            data: {},
        });
    }
    return next(err);
}
const router = (0, express_1.Router)();
router.get("/me/businesses/:businessId/products", auth_1.verifyHubJWT, (0, auth_1.requireHubRole)("HUB_OWNER", "HUB_ADMIN", "HUB_STAFF"), hubProducts_controller_1.getMyBusinessProducts);
router.post("/me/businesses/:businessId/products", auth_1.verifyHubJWT, (0, auth_1.requireHubRole)("HUB_OWNER", "HUB_ADMIN"), upload.array("images", 4), uploadErrorHandler, hubProducts_controller_1.createMyBusinessProduct);
router.patch("/me/businesses/:businessId/products/:productId", auth_1.verifyHubJWT, (0, auth_1.requireHubRole)("HUB_OWNER", "HUB_ADMIN"), hubProducts_controller_1.updateMyBusinessProduct);
router.delete("/me/businesses/:businessId/products/:productId", auth_1.verifyHubJWT, (0, auth_1.requireHubRole)("HUB_OWNER", "HUB_ADMIN"), hubProducts_controller_1.deleteMyBusinessProduct);
router.patch("/me/products/:productId/hub-categories", auth_1.verifyHubJWT, (0, auth_1.requireHubRole)("HUB_OWNER", "HUB_ADMIN"), hubProducts_controller_1.setMyProductHubCategories);
router.get("/me/businesses/:businessId/categories", auth_1.verifyHubJWT, (0, auth_1.requireHubRole)("HUB_OWNER", "HUB_ADMIN", "HUB_STAFF"), hubProducts_controller_1.getMyBusinessCategories);
exports.default = router;
