import { Router } from "express";
import {
    registerHubWithOwner,
    loginHubUser,
    createHubUser,
    getHubUsers,
    deleteHubUser,
    changeMyHubPassword,
    getMyHubUser,
    updateHubUserPermissions,
} from "../controllers/hubUsers.controller";
import { verifyHubJWT, requireHubRole } from "../utils/auth";

const router = Router();

// ---- Públicas (onboarding self-serve + login de todos los roles) ----
router.post("/register", registerHubWithOwner);
router.post("/login", loginHubUser);

// ---- Sesión propia: cambio de contraseña (solo dueño y admins) ----
router.patch("/me/password", verifyHubJWT, requireHubRole("HUB_OWNER", "HUB_ADMIN"), changeMyHubPassword);
// Usuario de la sesión (cualquier rol): refresca permisos sin volver a iniciar sesión.
router.get("/me", verifyHubJWT, getMyHubUser);

// ---- Protegidas ----
router.get("/", verifyHubJWT, requireHubRole("HUB_OWNER", "HUB_ADMIN"), getHubUsers);
router.post("/", verifyHubJWT, requireHubRole("HUB_OWNER", "HUB_ADMIN"), createHubUser);
router.delete("/:id", verifyHubJWT, requireHubRole("HUB_OWNER", "HUB_ADMIN"), deleteHubUser);
// Permisos finos de un BUSINESS_VIEWER (gestión de catálogo desde el portal).
router.patch("/:id/permissions", verifyHubJWT, requireHubRole("HUB_OWNER", "HUB_ADMIN"), updateHubUserPermissions);

export default router;
