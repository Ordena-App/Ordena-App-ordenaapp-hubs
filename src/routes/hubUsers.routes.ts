import { Router } from "express";
import {
    registerHubWithOwner,
    loginHubUser,
    createHubUser,
    getHubUsers,
    deleteHubUser,
} from "../controllers/hubUsers.controller";
import { verifyHubJWT, requireHubRole } from "../utils/auth";

const router = Router();

// ---- Públicas (onboarding self-serve + login de todos los roles) ----
router.post("/register", registerHubWithOwner);
router.post("/login", loginHubUser);

// ---- Protegidas ----
router.get("/", verifyHubJWT, requireHubRole("HUB_OWNER", "HUB_ADMIN"), getHubUsers);
router.post("/", verifyHubJWT, requireHubRole("HUB_OWNER", "HUB_ADMIN"), createHubUser);
router.delete("/:id", verifyHubJWT, requireHubRole("HUB_OWNER", "HUB_ADMIN"), deleteHubUser);

export default router;
