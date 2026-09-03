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
/**
 * Re-aplica los límites del catálogo hub_plans al snapshot de los hubs YA
 * suscritos (hub.subscription.limits).
 *   npx ts-node src/scripts/reapplyHubPlans.ts
 *
 * Cuándo usarlo: después de editar un plan (seedHubPlans o Mongo a mano) —
 * el snapshot desnormalizado de cada hub NO se actualiza solo hasta el
 * siguiente evento de facturación de Stripe.
 *
 * Toca SOLO subscription.limits.* (+ planRef.code si faltaba): no pisa
 * source/status/periodo/lookupKey, así que es seguro sobre suscripciones
 * manuales (Oe Ya) y hubs en trial por igual.
 */
const mongoose_1 = __importDefault(require("mongoose"));
const config_1 = require("../config/config");
const hubModel_1 = __importDefault(require("../models/hubModel"));
const hubPlanModel_1 = __importDefault(require("../models/hubPlanModel"));
function run() {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b, _c, _d, _e, _f;
        yield mongoose_1.default.connect(config_1.DB_LINK);
        const plans = yield hubPlanModel_1.default.find({ is_active: true });
        const byLookup = new Map();
        const byCode = new Map();
        for (const p of plans) {
            byCode.set(p.code, p);
            for (const lk of p.lookupKeys || [])
                byLookup.set(lk, p);
        }
        const hubs = yield hubModel_1.default.find({ "subscription.planRef.kind": "HUB_PLAN" });
        let updated = 0;
        for (const hub of hubs) {
            const ref = ((_a = hub.subscription) === null || _a === void 0 ? void 0 : _a.planRef) || {};
            const plan = (ref.lookupKey && byLookup.get(ref.lookupKey)) || (ref.code && byCode.get(ref.code)) || null;
            if (!plan) {
                console.warn(`[reapplyHubPlans] hub ${hub._id} (${hub.slug}) sin plan resoluble ` +
                    `(lookupKey='${ref.lookupKey || ""}', code='${ref.code || ""}') — se deja como está.`);
                continue;
            }
            const l = plan.limits || {};
            yield hubModel_1.default.updateOne({ _id: hub._id }, {
                $set: {
                    "subscription.planRef.code": plan.code,
                    "subscription.limits.businessesIncluded": (_b = l.businessesIncluded) !== null && _b !== void 0 ? _b : -1,
                    "subscription.limits.ordersPerMonth": (_c = l.ordersPerMonth) !== null && _c !== void 0 ? _c : -1,
                    "subscription.limits.extraBusinessPrice": (_d = l.extraBusinessPrice) !== null && _d !== void 0 ? _d : 0,
                    "subscription.limits.extraOrderPrice": (_e = l.extraOrderPrice) !== null && _e !== void 0 ? _e : 0,
                    "subscription.limits.businessesHardCap": (_f = l.businessesHardCap) !== null && _f !== void 0 ? _f : -1,
                    updated_at: new Date(),
                },
            });
            updated++;
            console.log(`[reapplyHubPlans] hub ${hub.slug}: ${plan.code} → ` +
                `${l.businessesIncluded} negocios / ${l.ordersPerMonth} pedidos / ` +
                `$${l.extraBusinessPrice} negocio extra / $${l.extraOrderPrice} pedido extra`);
        }
        console.log(`[reapplyHubPlans] ${updated}/${hubs.length} hubs re-aplicados.`);
        yield mongoose_1.default.disconnect();
    });
}
run().catch((e) => {
    console.error("[reapplyHubPlans] error:", e);
    process.exit(1);
});
