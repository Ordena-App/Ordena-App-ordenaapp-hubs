"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const multer_1 = __importDefault(require("multer"));
const hubBusinesses_controller_1 = require("../controllers/hubBusinesses.controller");
const auth_1 = require("../utils/auth");
const logoUpload = (0, multer_1.default)({ storage: multer_1.default.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024, files: 1 } });
const router = (0, express_1.Router)();
// ── Detalle / edición individual del negocio (F2.2) ──
router.get("/me/businesses/:businessId", auth_1.verifyHubJWT, (0, auth_1.requireHubRole)("HUB_OWNER", "HUB_ADMIN", "HUB_STAFF"), hubBusinesses_controller_1.getMyHubBusinessDetail);
router.patch("/me/businesses/:businessId", auth_1.verifyHubJWT, (0, auth_1.requireHubRole)("HUB_OWNER", "HUB_ADMIN"), hubBusinesses_controller_1.updateMyHubBusinessInfo);
router.post("/me/businesses/:businessId/logo", auth_1.verifyHubJWT, (0, auth_1.requireHubRole)("HUB_OWNER", "HUB_ADMIN"), logoUpload.single("image"), hubBusinesses_controller_1.uploadMyHubBusinessLogo);
router.patch("/me/businesses/:businessId/hours", auth_1.verifyHubJWT, (0, auth_1.requireHubRole)("HUB_OWNER", "HUB_ADMIN"), hubBusinesses_controller_1.updateMyHubBusinessHours);
router.get("/me/businesses", auth_1.verifyHubJWT, (0, auth_1.requireHubRole)("HUB_OWNER", "HUB_ADMIN", "HUB_STAFF"), hubBusinesses_controller_1.getMyHubBusinesses);
router.post("/me/businesses", auth_1.verifyHubJWT, (0, auth_1.requireHubRole)("HUB_OWNER", "HUB_ADMIN"), hubBusinesses_controller_1.createBusinessForMyHub);
router.patch("/me/businesses/:businessId/operational-status", auth_1.verifyHubJWT, (0, auth_1.requireHubRole)("HUB_OWNER", "HUB_ADMIN", "HUB_STAFF"), hubBusinesses_controller_1.updateBusinessOperationalStatus);
exports.default = router;
