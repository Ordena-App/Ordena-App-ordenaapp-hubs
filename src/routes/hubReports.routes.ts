import { Router } from "express";
import {
    getMyHubReportOverview,
    getMyHubReportCustomers,
    getMyHubReportVisits,
} from "../controllers/hubReports.controller";
import { verifyHubJWT, requireHubRole } from "../utils/auth";

const router = Router();

// Informes consolidados del hub. El BUSINESS_VIEWER queda fuera a propósito:
// su resumen propio ya existe en el Portal Business.
router.get(
    "/me/reports/overview",
    verifyHubJWT,
    requireHubRole("HUB_OWNER", "HUB_ADMIN", "HUB_STAFF"),
    getMyHubReportOverview
);
router.get(
    "/me/reports/customers",
    verifyHubJWT,
    requireHubRole("HUB_OWNER", "HUB_ADMIN", "HUB_STAFF"),
    getMyHubReportCustomers
);
router.get(
    "/me/reports/visits",
    verifyHubJWT,
    requireHubRole("HUB_OWNER", "HUB_ADMIN", "HUB_STAFF"),
    getMyHubReportVisits
);

export default router;
