"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const multer_1 = __importDefault(require("multer"));
const hubBusinesses_controller_1 = require("../controllers/hubBusinesses.controller");
const auth_1 = require("../utils/auth");
// Solo imágenes: evita que se suba y sirva contenido arbitrario desde el bucket.
const imageFileFilter = (_req, file, cb) => {
    if (/^image\/(jpeg|jpg|png|webp|gif|avif)$/i.test(file.mimetype))
        return cb(null, true);
    return cb(new Error("INVALID_FILE_TYPE"));
};
const logoUpload = (0, multer_1.default)({
    storage: multer_1.default.memoryStorage(),
    limits: { fileSize: 4 * 1024 * 1024, files: 1 },
    fileFilter: imageFileFilter,
});
function uploadErrorHandler(err, _req, res, next) {
    var _a, _b;
    if (!err)
        return next();
    if (((_b = (_a = err === null || err === void 0 ? void 0 : err.code) === null || _a === void 0 ? void 0 : _a.startsWith) === null || _b === void 0 ? void 0 : _b.call(_a, "LIMIT_")) || (err === null || err === void 0 ? void 0 : err.message) === "INVALID_FILE_TYPE") {
        return res.status(400).json({
            status: false,
            statusCode: 400,
            message: (err === null || err === void 0 ? void 0 : err.message) === "INVALID_FILE_TYPE"
                ? "Formato no soportado. Sube una imagen JPG, PNG, WEBP o GIF."
                : "La imagen supera el límite de 4 MB.",
            data: {},
        });
    }
    return next(err);
}
const router = (0, express_1.Router)();
// ── Detalle / edición individual del negocio (F2.2) ──
router.get("/me/businesses/:businessId", auth_1.verifyHubJWT, (0, auth_1.requireHubRole)("HUB_OWNER", "HUB_ADMIN", "HUB_STAFF"), hubBusinesses_controller_1.getMyHubBusinessDetail);
router.patch("/me/businesses/:businessId", auth_1.verifyHubJWT, (0, auth_1.requireHubRole)("HUB_OWNER", "HUB_ADMIN"), hubBusinesses_controller_1.updateMyHubBusinessInfo);
router.post("/me/businesses/:businessId/logo", auth_1.verifyHubJWT, (0, auth_1.requireHubRole)("HUB_OWNER", "HUB_ADMIN"), logoUpload.single("image"), uploadErrorHandler, hubBusinesses_controller_1.uploadMyHubBusinessLogo);
router.patch("/me/businesses/:businessId/hours", auth_1.verifyHubJWT, (0, auth_1.requireHubRole)("HUB_OWNER", "HUB_ADMIN"), hubBusinesses_controller_1.updateMyHubBusinessHours);
router.get("/me/businesses", auth_1.verifyHubJWT, (0, auth_1.requireHubRole)("HUB_OWNER", "HUB_ADMIN", "HUB_STAFF"), hubBusinesses_controller_1.getMyHubBusinesses);
router.post("/me/businesses", auth_1.verifyHubJWT, (0, auth_1.requireHubRole)("HUB_OWNER", "HUB_ADMIN"), hubBusinesses_controller_1.createBusinessForMyHub);
router.patch("/me/businesses/:businessId/operational-status", auth_1.verifyHubJWT, (0, auth_1.requireHubRole)("HUB_OWNER", "HUB_ADMIN", "HUB_STAFF"), hubBusinesses_controller_1.updateBusinessOperationalStatus);
exports.default = router;
