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
exports.applyPlanToHub = applyPlanToHub;
const hubModel_1 = __importDefault(require("../models/hubModel"));
/**
 * ÚNICO camino de escritura de hub.subscription desde el ciclo de facturación.
 * Escribe planRef + estado/periodo, y vuelca los límites del plan como snapshot
 * (hub.subscription.limits). Fuente de verdad = hub_plans; el snapshot evita
 * un join en el camino caliente de cada pedido (incrementHubOrderUsage).
 *
 * Si el plan no se encontró (lookupKey sin documento en hub_plans), se
 * actualizan estado/periodo pero NO los límites: quedan los que había —
 * fail-open deliberado (default -1 = ilimitado) con log ruidoso, porque
 * bloquear la operación de N negocios por un catálogo desalineado sería peor.
 */
function applyPlanToHub(params) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b, _c, _d, _e;
        const set = {
            "subscription.source": "STRIPE",
            "subscription.planRef.kind": "HUB_PLAN",
            "subscription.planRef.lookupKey": params.lookupKey,
            updated_at: new Date(),
        };
        if (params.status)
            set["subscription.status"] = params.status;
        if (params.billingCycle)
            set["subscription.billingCycle"] = params.billingCycle;
        if (params.periodStart)
            set["subscription.period.start"] = new Date(params.periodStart);
        if (params.periodEnd)
            set["subscription.period.end"] = new Date(params.periodEnd);
        if (params.plan) {
            if (params.plan.code)
                set["subscription.planRef.code"] = params.plan.code;
            const l = params.plan.limits || {};
            set["subscription.limits.businessesIncluded"] = (_a = l.businessesIncluded) !== null && _a !== void 0 ? _a : -1;
            set["subscription.limits.ordersPerMonth"] = (_b = l.ordersPerMonth) !== null && _b !== void 0 ? _b : -1;
            set["subscription.limits.extraBusinessPrice"] = (_c = l.extraBusinessPrice) !== null && _c !== void 0 ? _c : 0;
            set["subscription.limits.extraOrderPrice"] = (_d = l.extraOrderPrice) !== null && _d !== void 0 ? _d : 0;
            set["subscription.limits.businessesHardCap"] = (_e = l.businessesHardCap) !== null && _e !== void 0 ? _e : -1;
        }
        else {
            console.error("[applyPlanToHub] lookupKey '" + params.lookupKey + "' SIN documento en hub_plans: " +
                "se actualizo estado/periodo del hub " + params.hubId + " pero NO los limites. " +
                "Crear el plan en hub_plans (o corregir el lookup key en Stripe) y reaplicar.");
        }
        yield hubModel_1.default.updateOne({ _id: params.hubId }, { $set: set });
    });
}
