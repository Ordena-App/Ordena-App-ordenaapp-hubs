import { Router } from "express";
import {
    getMyHubCategories,
    createHubCategory,
    updateHubCategory,
    deleteHubCategory,
} from "../controllers/hubCategories.controller";
import { verifyHubJWT, requireHubRole } from "../utils/auth";

const router = Router();

router.get("/me/categories", verifyHubJWT, getMyHubCategories);
router.post("/me/categories", verifyHubJWT, requireHubRole("HUB_OWNER", "HUB_ADMIN"), createHubCategory);
router.put("/me/categories/:id", verifyHubJWT, requireHubRole("HUB_OWNER", "HUB_ADMIN"), updateHubCategory);
router.delete("/me/categories/:id", verifyHubJWT, requireHubRole("HUB_OWNER", "HUB_ADMIN"), deleteHubCategory);

export default router;
