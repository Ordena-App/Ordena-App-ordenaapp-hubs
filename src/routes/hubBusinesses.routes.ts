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

// Solo imágenes: evita que se suba y sirva contenido arbitrario desde el bucket.
const imageFileFilter = (_req: any, file: any, cb: any) => {
    if (/^image\/(jpeg|jpg|png|webp|gif|avif)$/i.test(file.mimetype)) return cb(null, true);
    return cb(new Error("INVALID_FILE_TYPE"));
};

const logoUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 4 * 1024 * 1024, files: 1 },
    fileFilter: imageFileFilter,
});

function uploadErrorHandler(err: any, _req: any, res: any, next: any): any {
    if (!err) return next();
    if (err?.code?.startsWith?.("LIMIT_") || err?.message === "INVALID_FILE_TYPE") {
        return res.status(400).json({
            status: false,
            statusCode: 400,
            message:
                err?.message === "INVALID_FILE_TYPE"
                    ? "Formato no soportado. Sube una imagen JPG, PNG, WEBP o GIF."
                    : "La imagen supera el límite de 4 MB.",
            data: {},
        });
    }
    return next(err);
}

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
    uploadErrorHandler,
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
