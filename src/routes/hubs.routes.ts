import { Router } from "express";
import { resolveHubBySlug, getMyHub, updateMyHub, incrementHubOrderUsage, getHubNotificationConfig } from "../controllers/hubs.controller";
import { verifyHubJWT, requireHubRole } from "../utils/auth";

const router = Router();

// Interna (orders-service): contador de pedidos del hub
router.patch("/internal/:hubId/usage/increment-order", incrementHubOrderUsage);
// Interna (orders): a quién avisar por WhatsApp y qué ve el negocio
router.get("/internal/:hubId/notification-config", getHubNotificationConfig);

// Pública: resolución de {slug}.ordena.app para middleware/storefront
router.get("/resolve", resolveHubBySlug);

// Protegidas
router.get("/me", verifyHubJWT, getMyHub);
router.put("/me", verifyHubJWT, requireHubRole("HUB_OWNER", "HUB_ADMIN"), updateMyHub);

export default router;
