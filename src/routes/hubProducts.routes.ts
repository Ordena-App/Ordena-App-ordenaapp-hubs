import { Router } from "express";
import multer from "multer";
import {
    getMyBusinessProducts,
    createMyBusinessProduct,
    updateMyBusinessProduct,
    deleteMyBusinessProduct,
    setMyProductHubCategories,
    getMyBusinessCategories,
} from "../controllers/hubProducts.controller";
import { verifyHubJWT, requireHubRole } from "../utils/auth";

// Imágenes en memoria: se re-envían a products-service, que las sube al bucket.
// Solo imágenes: evita que se suba y sirva contenido arbitrario desde el bucket.
const imageFileFilter = (_req: any, file: any, cb: any) => {
    if (/^image\/(jpeg|jpg|png|webp|gif|avif)$/i.test(file.mimetype)) return cb(null, true);
    return cb(new Error("INVALID_FILE_TYPE"));
};

const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 8 * 1024 * 1024, files: 4 },
    fileFilter: imageFileFilter,
});

/** Traduce errores de multer (tamaño/tipo/cantidad) a 400 con mensaje claro. */
function uploadErrorHandler(err: any, _req: any, res: any, next: any): any {
    if (!err) return next();
    const isTooLarge = err?.code === "LIMIT_FILE_SIZE";
    const isBadType = err?.message === "INVALID_FILE_TYPE";
    if (isTooLarge || isBadType || err?.code?.startsWith?.("LIMIT_")) {
        return res.status(400).json({
            status: false,
            statusCode: 400,
            message: isBadType
                ? "Formato no soportado. Sube imágenes JPG, PNG, WEBP o GIF."
                : isTooLarge
                    ? "La imagen supera el límite de 8 MB."
                    : "No se pudo procesar el archivo.",
            data: {},
        });
    }
    return next(err);
}

const router = Router();

router.get(
    "/me/businesses/:businessId/products",
    verifyHubJWT,
    requireHubRole("HUB_OWNER", "HUB_ADMIN", "HUB_STAFF"),
    getMyBusinessProducts
);
router.post(
    "/me/businesses/:businessId/products",
    verifyHubJWT,
    requireHubRole("HUB_OWNER", "HUB_ADMIN"),
    upload.array("images", 4),
    uploadErrorHandler,
    createMyBusinessProduct
);
router.patch(
    "/me/businesses/:businessId/products/:productId",
    verifyHubJWT,
    requireHubRole("HUB_OWNER", "HUB_ADMIN"),
    updateMyBusinessProduct
);
router.delete(
    "/me/businesses/:businessId/products/:productId",
    verifyHubJWT,
    requireHubRole("HUB_OWNER", "HUB_ADMIN"),
    deleteMyBusinessProduct
);
router.patch(
    "/me/products/:productId/hub-categories",
    verifyHubJWT,
    requireHubRole("HUB_OWNER", "HUB_ADMIN"),
    setMyProductHubCategories
);

router.get(
    "/me/businesses/:businessId/categories",
    verifyHubJWT,
    requireHubRole("HUB_OWNER", "HUB_ADMIN", "HUB_STAFF"),
    getMyBusinessCategories
);

export default router;
