"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const hubs_controller_1 = require("../controllers/hubs.controller");
const auth_1 = require("../utils/auth");
const router = (0, express_1.Router)();
// Pública: resolución de {slug}.ordena.app para middleware/storefront
router.get("/resolve", hubs_controller_1.resolveHubBySlug);
// Protegidas
router.get("/me", auth_1.verifyHubJWT, hubs_controller_1.getMyHub);
router.put("/me", auth_1.verifyHubJWT, (0, auth_1.requireHubRole)("HUB_OWNER", "HUB_ADMIN"), hubs_controller_1.updateMyHub);
exports.default = router;
