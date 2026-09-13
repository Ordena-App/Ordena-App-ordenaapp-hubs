import { Router } from "express";
import { getMyHubOrders, updateMyHubOrderStatus, getMyHubDashboard, getMyBusinessPortalSummary, notifyDeliveryForMyHubOrder } from "../controllers/hubOrders.controller";
import {
    getMyHubPaymentAccounts,
    createMyHubPaymentAccount,
    updateMyHubPaymentAccount,
    deleteMyHubPaymentAccount,
} from "../controllers/hubPayments.controller";
import {
    confirmMyHubOrder,
    rejectMyHubOrder,
    publishMyHubOrder,
    unpublishMyHubOrder,
    assignMyHubOrder,
    unassignMyHubOrder,
    updateMyHubOrderDeliveryStatus,
    getMyHubDrivers,
    getMyDriverOrders,
    claimMyDriverOrder,
    updateMyDriverOrderStatus,
} from "../controllers/hubOrderFlow.controller";
import { verifyHubJWT, requireHubRole } from "../utils/auth";

const router = Router();

// ── Dashboard + pedidos ──
// Pedidos: todos los roles (BUSINESS_VIEWER queda scoped a su negocio en el controller)
router.get("/me/dashboard", verifyHubJWT, requireHubRole("HUB_OWNER", "HUB_ADMIN", "HUB_STAFF"), getMyHubDashboard);
// Portal Business: resumen de UN negocio (viewer: el suyo; roles hub: ?businessId)
router.get(
    "/me/portal/summary",
    verifyHubJWT,
    requireHubRole("HUB_OWNER", "HUB_ADMIN", "HUB_STAFF", "BUSINESS_VIEWER"),
    getMyBusinessPortalSummary
);
router.get(
    "/me/orders",
    verifyHubJWT,
    requireHubRole("HUB_OWNER", "HUB_ADMIN", "HUB_STAFF", "BUSINESS_VIEWER"),
    getMyHubOrders
);
// Aviso al repartidor del hub (solo roles de hub: el delivery lo coordina el operador)
router.post(
    "/me/orders/:orderId/notify-delivery",
    verifyHubJWT,
    requireHubRole("HUB_OWNER", "HUB_ADMIN", "HUB_STAFF"),
    notifyDeliveryForMyHubOrder
);
router.patch(
    "/me/orders/:orderId/status",
    verifyHubJWT,
    requireHubRole("HUB_OWNER", "HUB_ADMIN", "HUB_STAFF", "BUSINESS_VIEWER"),
    updateMyHubOrderStatus
);

// ── Sprint 3: flujo del pedido (confirmación del hub + bolsa de repartidores) ──
// Solo roles de hub: el negocio no confirma ni asigna; el repartidor usa /me/driver/*.
const HUB_OPS = requireHubRole("HUB_OWNER", "HUB_ADMIN", "HUB_STAFF");
router.post("/me/orders/:orderId/confirm", verifyHubJWT, HUB_OPS, confirmMyHubOrder);
router.post("/me/orders/:orderId/reject", verifyHubJWT, HUB_OPS, rejectMyHubOrder);
router.post("/me/orders/:orderId/publish", verifyHubJWT, HUB_OPS, publishMyHubOrder);
router.post("/me/orders/:orderId/unpublish", verifyHubJWT, HUB_OPS, unpublishMyHubOrder);
router.post("/me/orders/:orderId/assign", verifyHubJWT, HUB_OPS, assignMyHubOrder);
router.post("/me/orders/:orderId/unassign", verifyHubJWT, HUB_OPS, unassignMyHubOrder);
router.patch("/me/orders/:orderId/delivery-status", verifyHubJWT, HUB_OPS, updateMyHubOrderDeliveryStatus);
router.get("/me/drivers", verifyHubJWT, HUB_OPS, getMyHubDrivers);

// App del repartidor: bolsa, mis pedidos, tomar y avanzar la entrega de LOS SUYOS.
const DRIVER = requireHubRole("DELIVERY_DRIVER");
router.get("/me/driver/orders", verifyHubJWT, DRIVER, getMyDriverOrders);
router.post("/me/driver/orders/:orderId/claim", verifyHubJWT, DRIVER, claimMyDriverOrder);
router.patch("/me/driver/orders/:orderId/status", verifyHubJWT, DRIVER, updateMyDriverOrderStatus);

// ── Métodos de pago centralizados del hub (solo administración) ──
router.get(
    "/me/payment-accounts/:method",
    verifyHubJWT,
    requireHubRole("HUB_OWNER", "HUB_ADMIN"),
    getMyHubPaymentAccounts
);
router.post(
    "/me/payment-accounts/:method",
    verifyHubJWT,
    requireHubRole("HUB_OWNER", "HUB_ADMIN"),
    createMyHubPaymentAccount
);
router.put(
    "/me/payment-accounts/:method/:accountId",
    verifyHubJWT,
    requireHubRole("HUB_OWNER", "HUB_ADMIN"),
    updateMyHubPaymentAccount
);
router.delete(
    "/me/payment-accounts/:method/:accountId",
    verifyHubJWT,
    requireHubRole("HUB_OWNER", "HUB_ADMIN"),
    deleteMyHubPaymentAccount
);

export default router;
