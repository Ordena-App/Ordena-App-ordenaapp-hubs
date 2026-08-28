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
exports.getHubReportOverview = getHubReportOverview;
exports.getHubReportCustomers = getHubReportCustomers;
const axios_1 = __importDefault(require("axios"));
const config_1 = require("../config/config");
// Reportes consolidados del hub (F3 v2 bloque C): las agregaciones viven en
// ms-reportes; aquí solo se proxean server-to-server con el secreto interno.
// El JWT del hub y su rol ya fueron validados en las rutas de este servicio.
function headers() {
    return { "x-ordena-secret": config_1.INTERNAL_SHARED_SECRET };
}
function getHubReportOverview(hubId, query) {
    return __awaiter(this, void 0, void 0, function* () {
        const { data } = yield axios_1.default.get(`${config_1.REPORTS_SERVICE_LINK}/reports/hub/${hubId}/overview`, {
            timeout: 30000,
            headers: headers(),
            params: query,
        });
        return data;
    });
}
function getHubReportCustomers(hubId, query) {
    return __awaiter(this, void 0, void 0, function* () {
        const { data } = yield axios_1.default.get(`${config_1.REPORTS_SERVICE_LINK}/reports/hub/${hubId}/customers/summary`, {
            timeout: 30000,
            headers: headers(),
            params: query,
        });
        return data;
    });
}
