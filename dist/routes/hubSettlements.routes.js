"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const hubSettlements_controller_1 = require("../controllers/hubSettlements.controller");
const auth_1 = require("../utils/auth");
const router = (0, express_1.Router)();
// Estado de cuenta del negocio (Portal Business) — ANTES de /me/settlements/:id
router.get("/me/portal/settlements", auth_1.verifyHubJWT, hubSettlements_controller_1.getMyPortalSettlements);
// Liquidaciones del hub
router.post("/me/settlements/generate", auth_1.verifyHubJWT, (0, auth_1.requireHubRole)("HUB_OWNER", "HUB_ADMIN"), hubSettlements_controller_1.generateMySettlements);
router.get("/me/settlements", auth_1.verifyHubJWT, (0, auth_1.requireHubRole)("HUB_OWNER", "HUB_ADMIN", "HUB_STAFF"), hubSettlements_controller_1.listMySettlements);
// El detalle lo puede ver también el BUSINESS_VIEWER dueño (candado en el controller)
router.get("/me/settlements/:id", auth_1.verifyHubJWT, hubSettlements_controller_1.getMySettlementDetail);
router.patch("/me/settlements/:id/paid", auth_1.verifyHubJWT, (0, auth_1.requireHubRole)("HUB_OWNER", "HUB_ADMIN"), hubSettlements_controller_1.markMySettlementPaid);
exports.default = router;
