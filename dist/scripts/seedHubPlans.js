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
 * Semilla idempotente del catálogo hub_plans (upsert por code).
 *   npx ts-node src/scripts/seedHubPlans.ts
 *
 * Los montos/límites son EDITABLES EN MONGO sin deploy — este seed solo
 * garantiza que los documentos existan. Cambiar un plan del catálogo NO
 * re-aplica los snapshots de hubs existentes (usar applyPlanToHub para eso).
 *
 * HUB_PILOTO (Oe Ya — precio preferente por proponer el modelo, isPublic false):
 *   trial 7 días → $149 → $199 tras 6 ciclos. Las DOS fases del Subscription
 *   Schedule usan lookup keys de ESTE plan (v1/v2): mismo plan y límites,
 *   solo cambia el precio — el webhook no necesita lógica especial en el mes 6.
 */
const mongoose_1 = __importDefault(require("mongoose"));
const config_1 = require("../config/config");
const hubPlanModel_1 = __importDefault(require("../models/hubPlanModel"));
const PLANS = [
    {
        code: "HUB_PILOTO",
        name: "Plan Piloto",
        description: "Plan preferente del hub piloto (Oe Ya). No aparece en la vitrina pública.",
        price: 149,
        currency: "USD",
        billingCycle: "monthly",
        lookupKeys: ["hub_piloto_monthly_v1", "hub_piloto_monthly_v2"],
        limits: {
            // Alineado a la operacion real de Oe Ya (~20 negocios, ~1,800
            // pedidos/mes): el crecimiento por encima se factura como
            // excedente en vez de regalarse dentro del incluido.
            businessesIncluded: 20,
            ordersPerMonth: 1800,
            // Negocio extra barato a proposito (conviene que agregue negocios:
            // escala el plan); el pedido extra a $0.10 cubre el costo real de
            // WhatsApp (~$0.06 en plantillas por pedido) y deja margen.
            extraBusinessPrice: 5,
            extraOrderPrice: 0.1,
            businessesHardCap: 100,
        },
        isPublic: false,
        is_active: true,
    },
    {
        code: "HUB_STANDARD",
        name: "Plan Hub",
        description: "Plan estándar para operadores multi-negocio.",
        price: 199,
        currency: "USD",
        billingCycle: "monthly",
        lookupKeys: ["hub_standard_monthly_v1"],
        limits: {
            businessesIncluded: 20,
            ordersPerMonth: 2000,
            extraBusinessPrice: 8,
            extraOrderPrice: 0.08,
            businessesHardCap: 100,
        },
        isPublic: true,
        is_active: true,
    },
];
function run() {
    return __awaiter(this, void 0, void 0, function* () {
        yield mongoose_1.default.connect(config_1.DB_LINK);
        for (const plan of PLANS) {
            const res = yield hubPlanModel_1.default.updateOne({ code: plan.code }, { $set: Object.assign(Object.assign({}, plan), { updated_at: new Date() }), $setOnInsert: { created_at: new Date() } }, { upsert: true });
            console.log(`[seedHubPlans] ${plan.code}: ${res.upsertedCount ? "creado" : "actualizado"}`);
        }
        yield mongoose_1.default.disconnect();
    });
}
run().catch((e) => {
    console.error("[seedHubPlans] error:", e);
    process.exit(1);
});
