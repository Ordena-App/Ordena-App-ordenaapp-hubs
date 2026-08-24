import { Router } from "express";
import multer from "multer";
import {
    getMyBusinessProducts,
    createMyBusinessProduct,
    updateMyBusinessProduct,
    deleteMyBusinessProduct,
    setMyProductHubCategories,
} from "../controllers/hubProducts.controller";
import { verifyHubJWT, requireHubRole } from "../utils/auth";

// Imágenes en memoria: se re-envían a products-service, que las sube al bucket.
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 8 * 1024 * 1024, files: 4 },
});

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

export default router;
