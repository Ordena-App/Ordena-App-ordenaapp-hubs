"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const hubOrders_controller_1 = require("../controllers/hubOrders.controller");
const hubPayments_controller_1 = require("../controllers/hubPayments.controller");
const hubOrderFlow_controller_1 = require("../controllers/hubOrderFlow.controller");
const auth_1 = require("../utils/auth");
const router = (0, express_1.Router)();
// ── Dashboard + pedidos ──
// Pedidos: todos los roles (BUSINESS_VIEWER queda scoped a su negocio en el controller)
router.get("/me/dashboard", auth_1.verifyHubJWT, (0, auth_1.requireHubRole)("HUB_OWNER", "HUB_ADMIN", "HUB_STAFF"), hubOrders_controller_1.getMyHubDashboard);
// Portal Business: resumen de UN negocio (viewer: el suyo; roles hub: ?businessId)
router.get("/me/portal/summary", auth_1.verifyHubJWT, (0, auth_1.requireHubRole)("HUB_OWNER", "HUB_ADMIN", "HUB_STAFF", "BUSINESS_VIEWER"), hubOrders_controller_1.getMyBusinessPortalSummary);
router.get("/me/orders", auth_1.verifyHubJWT, (0, auth_1.requireHubRole)("HUB_OWNER", "HUB_ADMIN", "HUB_STAFF", "BUSINESS_VIEWER"), hubOrders_controller_1.getMyHubOrders);
// Aviso al repartidor del hub (solo roles de hub: el delivery lo coordina el operador)
router.post("/me/orders/:orderId/notify-delivery", auth_1.verifyHubJWT, (0, auth_1.requireHubRole)("HUB_OWNER", "HUB_ADMIN", "HUB_STAFF"), hubOrders_controller_1.notifyDeliveryForMyHubOrder);
router.patch("/me/orders/:orderId/status", auth_1.verifyHubJWT, (0, auth_1.requireHubRole)("HUB_OWNER", "HUB_ADMIN", "HUB_STAFF", "BUSINESS_VIEWER"), hubOrders_controller_1.updateMyHubOrderStatus);
// ── Sprint 3: flujo del pedido (confirmación del hub + bolsa de repartidores) ──
// Solo roles de hub: el negocio no confirma ni asigna; el repartidor usa /me/driver/*.
const HUB_OPS = (0, auth_1.requireHubRole)("HUB_OWNER", "HUB_ADMIN", "HUB_STAFF");
router.post("/me/orders/:orderId/confirm", auth_1.verifyHubJWT, HUB_OPS, hubOrderFlow_controller_1.confirmMyHubOrder);
router.post("/me/orders/:orderId/reject", auth_1.verifyHubJWT, HUB_OPS, hubOrderFlow_controller_1.rejectMyHubOrder);
router.post("/me/orders/:orderId/publish", auth_1.verifyHubJWT, HUB_OPS, hubOrderFlow_controller_1.publishMyHubOrder);
router.post("/me/orders/:orderId/unpublish", auth_1.verifyHubJWT, HUB_OPS, hubOrderFlow_controller_1.unpublishMyHubOrder);
router.post("/me/orders/:orderId/assign", auth_1.verifyHubJWT, HUB_OPS, hubOrderFlow_controller_1.assignMyHubOrder);
router.post("/me/orders/:orderId/unassign", auth_1.verifyHubJWT, HUB_OPS, hubOrderFlow_controller_1.unassignMyHubOrder);
router.patch("/me/orders/:orderId/delivery-status", auth_1.verifyHubJWT, HUB_OPS, hubOrderFlow_controller_1.updateMyHubOrderDeliveryStatus);
// Sprint 5: el hub corrige el cobro registrado en un pedido ya entregado.
router.patch("/me/orders/:orderId/collection", auth_1.verifyHubJWT, HUB_OPS, hubOrderFlow_controller_1.setMyHubOrderCollection);
router.get("/me/drivers", auth_1.verifyHubJWT, HUB_OPS, hubOrderFlow_controller_1.getMyHubDrivers);
// App del repartidor: bolsa, mis pedidos, tomar y avanzar la entrega de LOS SUYOS.
const DRIVER = (0, auth_1.requireHubRole)("DELIVERY_DRIVER");
router.get("/me/driver/orders", auth_1.verifyHubJWT, DRIVER, hubOrderFlow_controller_1.getMyDriverOrders);
router.post("/me/driver/orders/:orderId/claim", auth_1.verifyHubJWT, DRIVER, hubOrderFlow_controller_1.claimMyDriverOrder);
router.patch("/me/driver/orders/:orderId/status", auth_1.verifyHubJWT, DRIVER, hubOrderFlow_controller_1.updateMyDriverOrderStatus);
// ── Métodos de pago centralizados del hub (solo administración) ──
router.get("/me/payment-accounts/:method", auth_1.verifyHubJWT, (0, auth_1.requireHubRole)("HUB_OWNER", "HUB_ADMIN"), hubPayments_controller_1.getMyHubPaymentAccounts);
router.post("/me/payment-accounts/:method", auth_1.verifyHubJWT, (0, auth_1.requireHubRole)("HUB_OWNER", "HUB_ADMIN"), hubPayments_controller_1.createMyHubPaymentAccount);
router.put("/me/payment-accounts/:method/:accountId", auth_1.verifyHubJWT, (0, auth_1.requireHubRole)("HUB_OWNER", "HUB_ADMIN"), hubPayments_controller_1.updateMyHubPaymentAccount);
router.delete("/me/payment-accounts/:method/:accountId", auth_1.verifyHubJWT, (0, auth_1.requireHubRole)("HUB_OWNER", "HUB_ADMIN"), hubPayments_controller_1.deleteMyHubPaymentAccount);
exports.default = router;
