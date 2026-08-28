"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const hubBilling_controller_1 = require("../controllers/hubBilling.controller");
const auth_1 = require("../utils/auth");
const router = (0, express_1.Router)();
// Interna (payments-service, webhook de Stripe): aplicar plan/estado/periodo
router.patch("/internal/:hubId/subscription", hubBilling_controller_1.patchHubSubscriptionInternal);
// Pública: catálogo de planes para la vitrina (solo isPublic)
router.get("/plans", hubBilling_controller_1.getHubPlansPublic);
// Protegidas
router.get("/me/billing", auth_1.verifyHubJWT, (0, auth_1.requireHubRole)("HUB_OWNER", "HUB_ADMIN"), hubBilling_controller_1.getMyHubBilling);
router.post("/me/billing/checkout-session", auth_1.verifyHubJWT, (0, auth_1.requireHubRole)("HUB_OWNER"), hubBilling_controller_1.createMyHubCheckoutSession);
router.post("/me/billing/portal-session", auth_1.verifyHubJWT, (0, auth_1.requireHubRole)("HUB_OWNER"), hubBilling_controller_1.createMyHubPortalSession);
exports.default = router;
