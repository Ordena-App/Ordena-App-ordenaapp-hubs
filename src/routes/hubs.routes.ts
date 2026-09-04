import { Router } from "express";
import { resolveHubBySlug, resolveHubStore, getMyHub, updateMyHub, incrementHubOrderUsage, getHubNotificationConfig } from "../controllers/hubs.controller";
import { verifyHubJWT, requireHubRole } from "../utils/auth";
import {
    setMyHubDomain,
    refreshMyHubDomainStatus,
    clearMyHubDomain,
    resolveHubByDomain,
} from "../controllers/hubDomain.controller";

const router = Router();

// Interna (orders-service): contador de pedidos del hub
router.patch("/internal/:hubId/usage/increment-order", incrementHubOrderUsage);
// Interna (orders): a quién avisar por WhatsApp y qué ve el negocio
router.get("/internal/:hubId/notification-config", getHubNotificationConfig);

// Pública: resolución de {slug}.ordena.app para middleware/storefront
router.get("/resolve", resolveHubBySlug);
// Pública: ¿este store_link namespaceado es de un hub? (redirect 301 en hosts core)
router.get("/resolve-store", resolveHubStore);
// Pública: resolución por dominio custom VERIFICADO (middleware y CORS del gateway)
router.get("/resolve-by-domain", resolveHubByDomain);

// Protegidas
router.get("/me", verifyHubJWT, getMyHub);
router.put("/me", verifyHubJWT, requireHubRole("HUB_OWNER", "HUB_ADMIN"), updateMyHub);

// Dominio custom del hub (F4)
router.post("/me/domain", verifyHubJWT, requireHubRole("HUB_OWNER"), setMyHubDomain);
router.get("/me/domain/status", verifyHubJWT, requireHubRole("HUB_OWNER", "HUB_ADMIN"), refreshMyHubDomainStatus);
router.delete("/me/domain", verifyHubJWT, requireHubRole("HUB_OWNER"), clearMyHubDomain);

export default router;
