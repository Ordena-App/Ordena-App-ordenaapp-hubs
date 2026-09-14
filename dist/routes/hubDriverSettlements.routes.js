"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const hubDriverSettlements_controller_1 = require("../controllers/hubDriverSettlements.controller");
const auth_1 = require("../utils/auth");
const router = (0, express_1.Router)();
// Sprint 5 — Liquidación de repartidores. Se monta en app.ts bajo /api/hubs
// ANTES de hubsRoutes (mismo patrón que hubSettlementsRoutes).
const HUB_ADMIN = (0, auth_1.requireHubRole)("HUB_OWNER", "HUB_ADMIN");
// App del repartidor: "Mi cuenta" (hoy, período actual, regla y sus liquidaciones)
router.get("/me/driver/account", auth_1.verifyHubJWT, (0, auth_1.requireHubRole)("DELIVERY_DRIVER"), hubDriverSettlements_controller_1.getMyDriverAccount);
// Liquidaciones del hub hacia sus repartidores
router.post("/me/driver-settlements/generate", auth_1.verifyHubJWT, HUB_ADMIN, hubDriverSettlements_controller_1.generateMyDriverSettlements);
router.get("/me/driver-settlements", auth_1.verifyHubJWT, HUB_ADMIN, hubDriverSettlements_controller_1.listMyDriverSettlements);
// El detalle lo puede ver también el DELIVERY_DRIVER dueño (candado en el controller)
router.get("/me/driver-settlements/:id", auth_1.verifyHubJWT, (0, auth_1.requireHubRole)("HUB_OWNER", "HUB_ADMIN", "DELIVERY_DRIVER"), hubDriverSettlements_controller_1.getMyDriverSettlementDetail);
router.patch("/me/driver-settlements/:id/paid", auth_1.verifyHubJWT, HUB_ADMIN, hubDriverSettlements_controller_1.markMyDriverSettlementPaid);
router.post("/me/driver-settlements/:id/adjustments", auth_1.verifyHubJWT, HUB_ADMIN, hubDriverSettlements_controller_1.addMyDriverSettlementAdjustment);
router.delete("/me/driver-settlements/:id/adjustments/:adjustmentId", auth_1.verifyHubJWT, HUB_ADMIN, hubDriverSettlements_controller_1.removeMyDriverSettlementAdjustment);
exports.default = router;
