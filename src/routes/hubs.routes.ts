import { Router } from "express";
import { resolveHubBySlug, getMyHub, updateMyHub, incrementHubOrderUsage } from "../controllers/hubs.controller";
import { verifyHubJWT, requireHubRole } from "../utils/auth";

const router = Router();

// Interna (orders-service): contador de pedidos del hub
router.patch("/internal/:hubId/usage/increment-order", incrementHubOrderUsage);

// Pública: resolución de {slug}.ordena.app para middleware/storefront
router.get("/resolve", resolveHubBySlug);

// Protegidas
router.get("/me", verifyHubJWT, getMyHub);
router.put("/me", verifyHubJWT, requireHubRole("HUB_OWNER", "HUB_ADMIN"), updateMyHub);

export default router;
