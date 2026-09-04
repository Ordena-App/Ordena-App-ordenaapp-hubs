"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getMyHubReportOverview = getMyHubReportOverview;
exports.getMyHubReportCustomers = getMyHubReportCustomers;
exports.getMyHubReportVisits = getMyHubReportVisits;
const hubModel_1 = __importDefault(require("../models/hubModel"));
const reportsService_external_1 = require("../services/reportsService.external");
function upstreamError(res, error, action) {
    var _a, _b, _c;
    const upstreamStatus = (_a = error === null || error === void 0 ? void 0 : error.response) === null || _a === void 0 ? void 0 : _a.status;
    if (upstreamStatus && upstreamStatus >= 400 && upstreamStatus < 500 && ((_b = error === null || error === void 0 ? void 0 : error.response) === null || _b === void 0 ? void 0 : _b.data)) {
        return res.status(upstreamStatus).json(error.response.data);
    }
    console.error(`Error en ${action}:`, ((_c = error === null || error === void 0 ? void 0 : error.response) === null || _c === void 0 ? void 0 : _c.data) || (error === null || error === void 0 ? void 0 : error.message) || error);
    return res.status(502).json({
        status: false,
        statusCode: 502,
        message: `No se pudo ${action} (reportes respondió ${upstreamStatus !== null && upstreamStatus !== void 0 ? upstreamStatus : "sin conexión"})`,
        data: {},
    });
}
function buildQuery(req, hubId) {
    return __awaiter(this, void 0, void 0, function* () {
        // La zona horaria del cálculo es la del HUB (no la del navegador): los
        // días del reporte deben cortar donde el operador vive.
        const hub = yield hubModel_1.default.findById(hubId).select("timezone").lean();
        return {
            from: typeof req.query.from === "string" ? req.query.from : undefined,
            to: typeof req.query.to === "string" ? req.query.to : undefined,
            granularity: typeof req.query.granularity === "string" ? req.query.granularity : undefined,
            tz: (hub === null || hub === void 0 ? void 0 : hub.timezone) || undefined,
        };
    });
}
/** GET /api/hubs/me/reports/overview  (roles de hub — el viewer no entra) */
function getMyHubReportOverview(req, res) {
    return __awaiter(this, void 0, void 0, function* () {
        const ctx = req.hubContext;
        try {
            const query = yield buildQuery(req, ctx.hubId);
            const resp = yield (0, reportsService_external_1.getHubReportOverview)(ctx.hubId, query);
            return res.status(200).json(resp);
        }
        catch (error) {
            return upstreamError(res, error, "cargar el informe del hub");
        }
    });
}
/** GET /api/hubs/me/reports/customers  (roles de hub) */
function getMyHubReportCustomers(req, res) {
    return __awaiter(this, void 0, void 0, function* () {
        const ctx = req.hubContext;
        try {
            const query = yield buildQuery(req, ctx.hubId);
            const resp = yield (0, reportsService_external_1.getHubReportCustomers)(ctx.hubId, query);
            return res.status(200).json(resp);
        }
        catch (error) {
            return upstreamError(res, error, "cargar los clientes del hub");
        }
    });
}
/** GET /api/hubs/me/reports/visits  (roles de hub) — tráfico consolidado */
function getMyHubReportVisits(req, res) {
    return __awaiter(this, void 0, void 0, function* () {
        const ctx = req.hubContext;
        try {
            const query = yield buildQuery(req, ctx.hubId);
            const resp = yield (0, reportsService_external_1.getHubReportVisits)(ctx.hubId, query);
            return res.status(200).json(resp);
        }
        catch (error) {
            return upstreamError(res, error, "cargar las visitas del hub");
        }
    });
}
