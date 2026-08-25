import { Router } from "express";
import multer from "multer";
import {
    createBusinessForMyHub,
    getMyHubBusinesses,
    updateBusinessOperationalStatus,
    getMyHubBusinessDetail,
    updateMyHubBusinessInfo,
    uploadMyHubBusinessLogo,
    updateMyHubBusinessHours,
} from "../controllers/hubBusinesses.controller";
import { verifyHubJWT, requireHubRole } from "../utils/auth";

const logoUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024, files: 1 } });

const router = Router();

// ── Detalle / edición individual del negocio (F2.2) ──
router.get(
    "/me/businesses/:businessId",
    verifyHubJWT,
    requireHubRole("HUB_OWNER", "HUB_ADMIN", "HUB_STAFF"),
    getMyHubBusinessDetail
);
router.patch(
    "/me/businesses/:businessId",
    verifyHubJWT,
    requireHubRole("HUB_OWNER", "HUB_ADMIN"),
    updateMyHubBusinessInfo
);
router.post(
    "/me/businesses/:businessId/logo",
    verifyHubJWT,
    requireHubRole("HUB_OWNER", "HUB_ADMIN"),
    logoUpload.single("image"),
    uploadMyHubBusinessLogo
);
router.patch(
    "/me/businesses/:businessId/hours",
    verifyHubJWT,
    requireHubRole("HUB_OWNER", "HUB_ADMIN"),
    updateMyHubBusinessHours
);

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
