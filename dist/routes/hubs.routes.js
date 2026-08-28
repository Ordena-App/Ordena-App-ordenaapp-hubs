"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const hubs_controller_1 = require("../controllers/hubs.controller");
const auth_1 = require("../utils/auth");
const hubDomain_controller_1 = require("../controllers/hubDomain.controller");
const router = (0, express_1.Router)();
// Interna (orders-service): contador de pedidos del hub
router.patch("/internal/:hubId/usage/increment-order", hubs_controller_1.incrementHubOrderUsage);
// Interna (orders): a quién avisar por WhatsApp y qué ve el negocio
router.get("/internal/:hubId/notification-config", hubs_controller_1.getHubNotificationConfig);
// Pública: resolución de {slug}.ordena.app para middleware/storefront
router.get("/resolve", hubs_controller_1.resolveHubBySlug);
// Pública: ¿este store_link namespaceado es de un hub? (redirect 301 en hosts core)
router.get("/resolve-store", hubs_controller_1.resolveHubStore);
// Pública: resolución por dominio custom VERIFICADO (middleware y CORS del gateway)
router.get("/resolve-by-domain", hubDomain_controller_1.resolveHubByDomain);
// Protegidas
router.get("/me", auth_1.verifyHubJWT, hubs_controller_1.getMyHub);
router.put("/me", auth_1.verifyHubJWT, (0, auth_1.requireHubRole)("HUB_OWNER", "HUB_ADMIN"), hubs_controller_1.updateMyHub);
// Dominio custom del hub (F4)
router.post("/me/domain", auth_1.verifyHubJWT, (0, auth_1.requireHubRole)("HUB_OWNER"), hubDomain_controller_1.setMyHubDomain);
router.get("/me/domain/status", auth_1.verifyHubJWT, (0, auth_1.requireHubRole)("HUB_OWNER", "HUB_ADMIN"), hubDomain_controller_1.refreshMyHubDomainStatus);
router.delete("/me/domain", auth_1.verifyHubJWT, (0, auth_1.requireHubRole)("HUB_OWNER"), hubDomain_controller_1.clearMyHubDomain);
exports.default = router;
