"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const hubUsers_controller_1 = require("../controllers/hubUsers.controller");
const auth_1 = require("../utils/auth");
const router = (0, express_1.Router)();
// ---- Públicas (onboarding self-serve + login de todos los roles) ----
router.post("/register", hubUsers_controller_1.registerHubWithOwner);
router.post("/login", hubUsers_controller_1.loginHubUser);
// ---- Protegidas ----
router.get("/", auth_1.verifyHubJWT, (0, auth_1.requireHubRole)("HUB_OWNER", "HUB_ADMIN"), hubUsers_controller_1.getHubUsers);
router.post("/", auth_1.verifyHubJWT, (0, auth_1.requireHubRole)("HUB_OWNER", "HUB_ADMIN"), hubUsers_controller_1.createHubUser);
router.delete("/:id", auth_1.verifyHubJWT, (0, auth_1.requireHubRole)("HUB_OWNER", "HUB_ADMIN"), hubUsers_controller_1.deleteHubUser);
exports.default = router;
