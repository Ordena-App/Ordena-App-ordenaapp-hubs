import { Router } from "express";
import {
    generateMyDriverSettlements,
    listMyDriverSettlements,
    getMyDriverSettlementDetail,
    markMyDriverSettlementPaid,
    addMyDriverSettlementAdjustment,
    removeMyDriverSettlementAdjustment,
    getMyDriverAccount,
} from "../controllers/hubDriverSettlements.controller";
import { verifyHubJWT, requireHubRole } from "../utils/auth";

const router = Router();

// Sprint 5 — Liquidación de repartidores. Se monta en app.ts bajo /api/hubs
// ANTES de hubsRoutes (mismo patrón que hubSettlementsRoutes).
const HUB_ADMIN = requireHubRole("HUB_OWNER", "HUB_ADMIN");

// App del repartidor: "Mi cuenta" (hoy, período actual, regla y sus liquidaciones)
router.get("/me/driver/account", verifyHubJWT, requireHubRole("DELIVERY_DRIVER"), getMyDriverAccount);

// Liquidaciones del hub hacia sus repartidores
router.post("/me/driver-settlements/generate", verifyHubJWT, HUB_ADMIN, generateMyDriverSettlements);
router.get("/me/driver-settlements", verifyHubJWT, HUB_ADMIN, listMyDriverSettlements);
// El detalle lo puede ver también el DELIVERY_DRIVER dueño (candado en el controller)
router.get(
    "/me/driver-settlements/:id",
    verifyHubJWT,
    requireHubRole("HUB_OWNER", "HUB_ADMIN", "DELIVERY_DRIVER"),
    getMyDriverSettlementDetail
);
router.patch("/me/driver-settlements/:id/paid", verifyHubJWT, HUB_ADMIN, markMyDriverSettlementPaid);
router.post("/me/driver-settlements/:id/adjustments", verifyHubJWT, HUB_ADMIN, addMyDriverSettlementAdjustment);
router.delete("/me/driver-settlements/:id/adjustments/:adjustmentId", verifyHubJWT, HUB_ADMIN, removeMyDriverSettlementAdjustment);

export default router;
