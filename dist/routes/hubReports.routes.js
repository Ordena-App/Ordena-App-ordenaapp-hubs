"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const hubReports_controller_1 = require("../controllers/hubReports.controller");
const auth_1 = require("../utils/auth");
const router = (0, express_1.Router)();
// Informes consolidados del hub. El BUSINESS_VIEWER queda fuera a propósito:
// su resumen propio ya existe en el Portal Business.
router.get("/me/reports/overview", auth_1.verifyHubJWT, (0, auth_1.requireHubRole)("HUB_OWNER", "HUB_ADMIN", "HUB_STAFF"), hubReports_controller_1.getMyHubReportOverview);
router.get("/me/reports/customers", auth_1.verifyHubJWT, (0, auth_1.requireHubRole)("HUB_OWNER", "HUB_ADMIN", "HUB_STAFF"), hubReports_controller_1.getMyHubReportCustomers);
exports.default = router;
