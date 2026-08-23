"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const hubOrders_controller_1 = require("../controllers/hubOrders.controller");
const hubPayments_controller_1 = require("../controllers/hubPayments.controller");
const auth_1 = require("../utils/auth");
const router = (0, express_1.Router)();
// ── Dashboard + pedidos ──
// Pedidos: todos los roles (BUSINESS_VIEWER queda scoped a su negocio en el controller)
router.get("/me/dashboard", auth_1.verifyHubJWT, (0, auth_1.requireHubRole)("HUB_OWNER", "HUB_ADMIN", "HUB_STAFF"), hubOrders_controller_1.getMyHubDashboard);
// Portal Business: resumen de UN negocio (viewer: el suyo; roles hub: ?businessId)
router.get("/me/portal/summary", auth_1.verifyHubJWT, (0, auth_1.requireHubRole)("HUB_OWNER", "HUB_ADMIN", "HUB_STAFF", "BUSINESS_VIEWER"), hubOrders_controller_1.getMyBusinessPortalSummary);
router.get("/me/orders", auth_1.verifyHubJWT, (0, auth_1.requireHubRole)("HUB_OWNER", "HUB_ADMIN", "HUB_STAFF", "BUSINESS_VIEWER"), hubOrders_controller_1.getMyHubOrders);
router.patch("/me/orders/:orderId/status", auth_1.verifyHubJWT, (0, auth_1.requireHubRole)("HUB_OWNER", "HUB_ADMIN", "HUB_STAFF", "BUSINESS_VIEWER"), hubOrders_controller_1.updateMyHubOrderStatus);
// ── Métodos de pago centralizados del hub (solo administración) ──
router.get("/me/payment-accounts/:method", auth_1.verifyHubJWT, (0, auth_1.requireHubRole)("HUB_OWNER", "HUB_ADMIN"), hubPayments_controller_1.getMyHubPaymentAccounts);
router.post("/me/payment-accounts/:method", auth_1.verifyHubJWT, (0, auth_1.requireHubRole)("HUB_OWNER", "HUB_ADMIN"), hubPayments_controller_1.createMyHubPaymentAccount);
router.put("/me/payment-accounts/:method/:accountId", auth_1.verifyHubJWT, (0, auth_1.requireHubRole)("HUB_OWNER", "HUB_ADMIN"), hubPayments_controller_1.updateMyHubPaymentAccount);
router.delete("/me/payment-accounts/:method/:accountId", auth_1.verifyHubJWT, (0, auth_1.requireHubRole)("HUB_OWNER", "HUB_ADMIN"), hubPayments_controller_1.deleteMyHubPaymentAccount);
exports.default = router;
