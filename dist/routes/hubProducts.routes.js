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
const upload = (0, multer_1.default)({
    storage: multer_1.default.memoryStorage(),
    limits: { fileSize: 8 * 1024 * 1024, files: 4 },
});
const router = (0, express_1.Router)();
router.get("/me/businesses/:businessId/products", auth_1.verifyHubJWT, (0, auth_1.requireHubRole)("HUB_OWNER", "HUB_ADMIN", "HUB_STAFF"), hubProducts_controller_1.getMyBusinessProducts);
router.post("/me/businesses/:businessId/products", auth_1.verifyHubJWT, (0, auth_1.requireHubRole)("HUB_OWNER", "HUB_ADMIN"), upload.array("images", 4), hubProducts_controller_1.createMyBusinessProduct);
router.patch("/me/businesses/:businessId/products/:productId", auth_1.verifyHubJWT, (0, auth_1.requireHubRole)("HUB_OWNER", "HUB_ADMIN"), hubProducts_controller_1.updateMyBusinessProduct);
router.delete("/me/businesses/:businessId/products/:productId", auth_1.verifyHubJWT, (0, auth_1.requireHubRole)("HUB_OWNER", "HUB_ADMIN"), hubProducts_controller_1.deleteMyBusinessProduct);
router.patch("/me/products/:productId/hub-categories", auth_1.verifyHubJWT, (0, auth_1.requireHubRole)("HUB_OWNER", "HUB_ADMIN"), hubProducts_controller_1.setMyProductHubCategories);
exports.default = router;
