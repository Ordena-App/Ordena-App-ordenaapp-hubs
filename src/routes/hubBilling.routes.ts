import { Router } from "express";
import {
    patchHubSubscriptionInternal,
    getHubPlansPublic,
    getMyHubBilling,
    createMyHubCheckoutSession,
    createMyHubPortalSession,
} from "../controllers/hubBilling.controller";
import { verifyHubJWT, requireHubRole } from "../utils/auth";

const router = Router();

// Interna (payments-service, webhook de Stripe): aplicar plan/estado/periodo
router.patch("/internal/:hubId/subscription", patchHubSubscriptionInternal);

// Pública: catálogo de planes para la vitrina (solo isPublic)
router.get("/plans", getHubPlansPublic);

// Protegidas
router.get("/me/billing", verifyHubJWT, requireHubRole("HUB_OWNER", "HUB_ADMIN"), getMyHubBilling);
router.post("/me/billing/checkout-session", verifyHubJWT, requireHubRole("HUB_OWNER"), createMyHubCheckoutSession);
router.post("/me/billing/portal-session", verifyHubJWT, requireHubRole("HUB_OWNER"), createMyHubPortalSession);

export default router;
