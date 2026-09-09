import { Router } from "express";
import {
    registerHubWithOwner,
    loginHubUser,
    createHubUser,
    getHubUsers,
    deleteHubUser,
    changeMyHubPassword,
} from "../controllers/hubUsers.controller";
import { verifyHubJWT, requireHubRole } from "../utils/auth";

const router = Router();

// ---- Públicas (onboarding self-serve + login de todos los roles) ----
router.post("/register", registerHubWithOwner);
router.post("/login", loginHubUser);

// ---- Sesión propia (cualquier rol): cambio de contraseña ----
router.patch("/me/password", verifyHubJWT, changeMyHubPassword);

// ---- Protegidas ----
router.get("/", verifyHubJWT, requireHubRole("HUB_OWNER", "HUB_ADMIN"), getHubUsers);
router.post("/", verifyHubJWT, requireHubRole("HUB_OWNER", "HUB_ADMIN"), createHubUser);
router.delete("/:id", verifyHubJWT, requireHubRole("HUB_OWNER", "HUB_ADMIN"), deleteHubUser);

export default router;
