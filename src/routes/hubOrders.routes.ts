import { Router } from "express";
import { getMyHubOrders, updateMyHubOrderStatus, getMyHubDashboard, getMyBusinessPortalSummary } from "../controllers/hubOrders.controller";
import {
    getMyHubPaymentAccounts,
    createMyHubPaymentAccount,
    updateMyHubPaymentAccount,
    deleteMyHubPaymentAccount,
} from "../controllers/hubPayments.controller";
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
router.patch(
    "/me/orders/:orderId/status",
    verifyHubJWT,
    requireHubRole("HUB_OWNER", "HUB_ADMIN", "HUB_STAFF", "BUSINESS_VIEWER"),
    updateMyHubOrderStatus
);

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
