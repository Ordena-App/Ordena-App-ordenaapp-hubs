import { Router } from "express";
import {
    createBusinessForMyHub,
    getMyHubBusinesses,
    updateBusinessOperationalStatus,
} from "../controllers/hubBusinesses.controller";
import { verifyHubJWT, requireHubRole } from "../utils/auth";

const router = Router();

router.get(
    "/me/businesses",
    verifyHubJWT,
    requireHubRole("HUB_OWNER", "HUB_ADMIN", "HUB_STAFF"),
    getMyHubBusinesses
);
router.post(
    "/me/businesses",
    verifyHubJWT,
    requireHubRole("HUB_OWNER", "HUB_ADMIN"),
    createBusinessForMyHub
);
router.patch(
    "/me/businesses/:businessId/operational-status",
    verifyHubJWT,
    requireHubRole("HUB_OWNER", "HUB_ADMIN", "HUB_STAFF"),
    updateBusinessOperationalStatus
);

export default router;
