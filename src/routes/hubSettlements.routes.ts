import { Router } from "express";
import {
    generateMySettlements,
    listMySettlements,
    getMySettlementDetail,
    markMySettlementPaid,
    getMyPortalSettlements,
} from "../controllers/hubSettlements.controller";
import { verifyHubJWT, requireHubRole } from "../utils/auth";

const router = Router();

// Estado de cuenta del negocio (Portal Business) — ANTES de /me/settlements/:id
router.get("/me/portal/settlements", verifyHubJWT, getMyPortalSettlements);

// Liquidaciones del hub
router.post(
    "/me/settlements/generate",
    verifyHubJWT,
    requireHubRole("HUB_OWNER", "HUB_ADMIN"),
    generateMySettlements
);
router.get(
    "/me/settlements",
    verifyHubJWT,
    requireHubRole("HUB_OWNER", "HUB_ADMIN", "HUB_STAFF"),
    listMySettlements
);
// El detalle lo puede ver también el BUSINESS_VIEWER dueño (candado en el controller)
router.get("/me/settlements/:id", verifyHubJWT, getMySettlementDetail);
router.patch(
    "/me/settlements/:id/paid",
    verifyHubJWT,
    requireHubRole("HUB_OWNER", "HUB_ADMIN"),
    markMySettlementPaid
);

export default router;
