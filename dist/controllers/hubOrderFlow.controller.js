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
exports.confirmMyHubOrder = confirmMyHubOrder;
exports.rejectMyHubOrder = rejectMyHubOrder;
exports.publishMyHubOrder = publishMyHubOrder;
exports.unpublishMyHubOrder = unpublishMyHubOrder;
exports.assignMyHubOrder = assignMyHubOrder;
exports.unassignMyHubOrder = unassignMyHubOrder;
exports.updateMyHubOrderDeliveryStatus = updateMyHubOrderDeliveryStatus;
exports.setMyHubOrderCollection = setMyHubOrderCollection;
exports.getMyHubDrivers = getMyHubDrivers;
exports.getMyDriverOrders = getMyDriverOrders;
exports.claimMyDriverOrder = claimMyDriverOrder;
exports.updateMyDriverOrderStatus = updateMyDriverOrderStatus;
const hubModel_1 = __importDefault(require("../models/hubModel"));
const hubUserModel_1 = __importDefault(require("../models/hubUserModel"));
const ordersService_external_1 = require("../services/ordersService.external");
const businessService_external_1 = require("../services/businessService.external");
// ════════════════════════════════════════════════════════════════════════════
// Sprint 3 — Flujo del pedido: confirmación del hub, bolsa de repartidores y
// app del repartidor. Este servicio decide QUIÉN puede hacer qué (rol del JWT)
// y qué datos del cliente ve el repartidor (driverVisibility); orders ejecuta
// la máquina de estados y re-valida el scope hub↔pedido.
// ════════════════════════════════════════════════════════════════════════════
function upstream(res, error, action) {
    var _a, _b, _c;
    const st = (_a = error === null || error === void 0 ? void 0 : error.response) === null || _a === void 0 ? void 0 : _a.status;
    if (st && st >= 400 && st < 500 && ((_b = error === null || error === void 0 ? void 0 : error.response) === null || _b === void 0 ? void 0 : _b.data)) {
        return res.status(st).json(error.response.data);
    }
    console.error(`Error en ${action}:`, ((_c = error === null || error === void 0 ? void 0 : error.response) === null || _c === void 0 ? void 0 : _c.data) || (error === null || error === void 0 ? void 0 : error.message) || error);
    return res.status(502).json({
        status: false,
        statusCode: 502,
        message: `No se pudo ${action} (orders-service respondió ${st !== null && st !== void 0 ? st : "sin conexión"})`,
        data: {},
    });
}
/** Quién ejecuta la acción (nombre para el historial del pedido). */
function actorOf(ctx) {
    return __awaiter(this, void 0, void 0, function* () {
        let name = ctx.email;
        try {
            const u = yield hubUserModel_1.default.findById(ctx.userId).select("name email").lean();
            if (u === null || u === void 0 ? void 0 : u.name)
                name = String(u.name);
            else if (u === null || u === void 0 ? void 0 : u.email)
                name = String(u.email);
        }
        catch (_a) {
            /* el email del token basta */
        }
        return { id: String(ctx.userId), name: String(name || "").slice(0, 80), role: ctx.role };
    });
}
function runFlow(res, ctx, orderId, body, actionLabel) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            const actor = yield actorOf(ctx);
            const resp = yield (0, ordersService_external_1.hubOrderFlowExternal)(ctx.hubId, orderId, Object.assign(Object.assign({}, body), { actor }));
            return res.status(200).json(resp);
        }
        catch (error) {
            return upstream(res, error, actionLabel);
        }
    });
}
// ── Acciones del hub (HUB_OWNER / HUB_ADMIN / HUB_STAFF) ──
/** POST /me/orders/:orderId/confirm  Body: { publish?: boolean } */
function confirmMyHubOrder(req, res) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b;
        const ctx = req.hubContext;
        let publish = (_a = req.body) === null || _a === void 0 ? void 0 : _a.publish;
        if (typeof publish !== "boolean") {
            const hub = yield hubModel_1.default.findById(ctx.hubId).select("orderFlow").lean();
            publish = ((_b = hub === null || hub === void 0 ? void 0 : hub.orderFlow) === null || _b === void 0 ? void 0 : _b.autoPublishOnConfirm) !== false;
        }
        return runFlow(res, ctx, String(req.params.orderId), { action: "confirm", publish }, "confirmar el pedido");
    });
}
/** POST /me/orders/:orderId/reject  Body: { reason?: string } */
function rejectMyHubOrder(req, res) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a;
        const ctx = req.hubContext;
        const reason = typeof ((_a = req.body) === null || _a === void 0 ? void 0 : _a.reason) === "string" ? req.body.reason.trim().slice(0, 300) : "";
        return runFlow(res, ctx, String(req.params.orderId), { action: "reject", reason }, "rechazar el pedido");
    });
}
/** POST /me/orders/:orderId/publish */
function publishMyHubOrder(req, res) {
    return __awaiter(this, void 0, void 0, function* () {
        return runFlow(res, req.hubContext, String(req.params.orderId), { action: "publish" }, "publicar el pedido");
    });
}
/** POST /me/orders/:orderId/unpublish */
function unpublishMyHubOrder(req, res) {
    return __awaiter(this, void 0, void 0, function* () {
        return runFlow(res, req.hubContext, String(req.params.orderId), { action: "unpublish" }, "retirar el pedido de la bolsa");
    });
}
/** POST /me/orders/:orderId/assign  Body: { driverId } — el repartidor debe ser de ESTE hub. */
function assignMyHubOrder(req, res) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a;
        const ctx = req.hubContext;
        const driverId = String(((_a = req.body) === null || _a === void 0 ? void 0 : _a.driverId) || "");
        if (!/^[0-9a-fA-F]{24}$/.test(driverId)) {
            return res.status(400).json({ status: false, statusCode: 400, message: "driverId es requerido", data: {} });
        }
        const driver = yield hubUserModel_1.default
            .findOne({ _id: driverId, hub_id: ctx.hubId, role: "DELIVERY_DRIVER" })
            .select("name email status")
            .lean();
        if (!driver || driver.status !== "ACTIVE") {
            return res.status(404).json({ status: false, statusCode: 404, message: "Repartidor no encontrado en este hub", data: {} });
        }
        return runFlow(res, ctx, String(req.params.orderId), { action: "assign", driver: { id: String(driver._id), name: String(driver.name || driver.email || "") } }, "asignar el pedido");
    });
}
/** POST /me/orders/:orderId/unassign  Body: { republish?: boolean } (default true) */
function unassignMyHubOrder(req, res) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a;
        const republish = ((_a = req.body) === null || _a === void 0 ? void 0 : _a.republish) !== false;
        return runFlow(res, req.hubContext, String(req.params.orderId), { action: "unassign", republish }, "liberar el pedido");
    });
}
/** PATCH /me/orders/:orderId/delivery-status  Body: { status, note? } — el hub mueve cualquier pedido. */
function updateMyHubOrderDeliveryStatus(req, res) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b, _c;
        const status = String(((_a = req.body) === null || _a === void 0 ? void 0 : _a.status) || "");
        const note = typeof ((_b = req.body) === null || _b === void 0 ? void 0 : _b.note) === "string" ? req.body.note.slice(0, 300) : null;
        const collection = sanitizeCollection((_c = req.body) === null || _c === void 0 ? void 0 : _c.collection);
        return runFlow(res, req.hubContext, String(req.params.orderId), Object.assign({ action: "delivery_status", status, note }, (collection ? { collection } : {})), "actualizar la entrega");
    });
}
// ── Sprint 5: cobro registrado al entregar ──
/**
 * Sanea body.collection { collected, method?, amount? }. Devuelve null si no es
 * un objeto con `collected` booleano (orders lo trata como "no cobró"). Las
 * reglas de negocio (monto por defecto, payment_status) viven en orders.
 */
function sanitizeCollection(raw) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw))
        return null;
    const o = raw;
    if (typeof o.collected !== "boolean")
        return null;
    const out = { collected: o.collected };
    if (o.method === "cash" || o.method === "wallet" || o.method === "none")
        out.method = o.method;
    if (typeof o.amount === "number" && Number.isFinite(o.amount) && o.amount > 0)
        out.amount = Math.round(o.amount * 100) / 100;
    return out;
}
/**
 * PATCH /me/orders/:orderId/collection  Body: { collection: { collected, method?, amount? } }
 * El hub corrige lo que el repartidor registró (o no) al entregar. Solo aplica a
 * pedidos ya entregados (orders lo valida). Responde el pedido actualizado.
 */
function setMyHubOrderCollection(req, res) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a;
        const collection = sanitizeCollection((_a = req.body) === null || _a === void 0 ? void 0 : _a.collection);
        if (!collection) {
            return res.status(400).json({
                status: false,
                statusCode: 400,
                message: "collection es requerido: { collected: boolean, method?: cash|wallet|none, amount?: number }",
                data: {},
            });
        }
        return runFlow(res, req.hubContext, String(req.params.orderId), { action: "set_collection", collection }, "registrar el cobro");
    });
}
/** GET /me/drivers — repartidores del hub (para asignar a mano y para Usuarios). */
function getMyHubDrivers(req, res) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            const ctx = req.hubContext;
            const drivers = yield hubUserModel_1.default
                .find({ hub_id: ctx.hubId, role: "DELIVERY_DRIVER" })
                .select("name email phone status created_at")
                .sort({ name: 1, created_at: -1 })
                .lean();
            return res.status(200).json({ status: true, statusCode: 200, message: "Repartidores del hub", data: { drivers } });
        }
        catch (error) {
            console.error("Error listando repartidores:", error);
            return res.status(500).json({ status: false, statusCode: 500, message: "Error interno del servidor", data: {} });
        }
    });
}
function readDriverVisibility(hubId) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b;
        const hub = yield hubModel_1.default.findById(hubId).select("driverVisibility").lean();
        return {
            customerName: ((_a = hub === null || hub === void 0 ? void 0 : hub.driverVisibility) === null || _a === void 0 ? void 0 : _a.customerName) !== false,
            customerPhone: ((_b = hub === null || hub === void 0 ? void 0 : hub.driverVisibility) === null || _b === void 0 ? void 0 : _b.customerPhone) === true,
        };
    });
}
// Negocios del hub (nombre, dirección, teléfono para la recogida). Caché corta:
// la app refresca cada pocos segundos y los negocios casi no cambian.
const businessCache = new Map();
function businessMapFor(hubId) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a;
        const cached = businessCache.get(hubId);
        if (cached && Date.now() - cached.at < 60000)
            return cached.map;
        const map = new Map();
        try {
            const resp = yield (0, businessService_external_1.getBusinessesByHubId)(hubId);
            const list = ((_a = resp === null || resp === void 0 ? void 0 : resp.data) === null || _a === void 0 ? void 0 : _a.businesses) || [];
            for (const b of list)
                map.set(String(b._id), b);
        }
        catch (e) {
            console.error("[driver] no se pudo leer los negocios del hub:", e === null || e === void 0 ? void 0 : e.message);
            if (cached)
                return cached.map;
        }
        businessCache.set(hubId, { at: Date.now(), map });
        return map;
    });
}
/**
 * Proyección ALLOWLIST del pedido para el repartidor. Del cliente: dirección,
 * referencia y pin siempre; nombre y teléfono según la matriz del hub. Nunca
 * email, comprobante, atribución, comisiones ni auditoría interna.
 */
function driverOrderView(order, vis, businesses) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o;
    const biz = businesses.get(String(order.bussiness_id)) || null;
    const a = order.delivery_assignment || {};
    const items = Array.isArray(order.items)
        ? order.items.map((it) => {
            var _a, _b, _c, _d;
            return ({
                quantity: Number(it === null || it === void 0 ? void 0 : it.quantity) || 1,
                name: ((_a = it === null || it === void 0 ? void 0 : it.product_details) === null || _a === void 0 ? void 0 : _a.name) || ((_b = it === null || it === void 0 ? void 0 : it.product) === null || _b === void 0 ? void 0 : _b.name) || "Producto",
                variants: Array.isArray((_c = it === null || it === void 0 ? void 0 : it.product_details) === null || _c === void 0 ? void 0 : _c.variants)
                    ? it.product_details.variants
                        .map((v) => [v === null || v === void 0 ? void 0 : v.variant_name, v === null || v === void 0 ? void 0 : v.variant_value].filter(Boolean).join(": "))
                        .filter(Boolean)
                    : [],
                options: Array.isArray((_d = it === null || it === void 0 ? void 0 : it.product_details) === null || _d === void 0 ? void 0 : _d.options)
                    ? it.product_details.options.map((o) => o === null || o === void 0 ? void 0 : o.option_name).filter(Boolean)
                    : [],
            });
        })
        : [];
    return {
        _id: order._id,
        orderNumber: (_a = order.orderNumber) !== null && _a !== void 0 ? _a : null,
        created_at: order.created_at,
        order_status: order.order_status,
        delivery_method: order.delivery_method,
        delivery_address: order.delivery_address || null,
        delivery_city: order.delivery_city || null,
        delivery_department: order.delivery_department || null,
        delivery_reference: order.delivery_reference || null,
        delivery_geo: order.delivery_geo || null,
        delivery_distance_km: (_b = order.delivery_distance_km) !== null && _b !== void 0 ? _b : null,
        delivery_cost: (_c = order.delivery_cost) !== null && _c !== void 0 ? _c : null,
        total_amount: (_d = order.total_amount) !== null && _d !== void 0 ? _d : null,
        order_total: (_e = order.order_total) !== null && _e !== void 0 ? _e : null,
        payment_type: order.payment_type || ((_f = order.payment) === null || _f === void 0 ? void 0 : _f.payment_method) || null,
        payment_status: order.payment_status || ((_g = order.payment) === null || _g === void 0 ? void 0 : _g.payment_status) || null,
        order_note: order.order_note || null,
        items,
        items_count: items.reduce((acc, it) => acc + (Number(it.quantity) || 1), 0),
        customer_name: vis.customerName ? order.customer_name || null : null,
        customer_number: vis.customerPhone ? order.customer_number || null : null,
        delivery_assignment: {
            status: a.status || "none",
            published_at: a.published_at || null,
            driver_id: a.driver_id || null,
            driver_name: a.driver_name || null,
            assigned_at: a.assigned_at || null,
            picked_up_at: a.picked_up_at || null,
            on_the_way_at: a.on_the_way_at || null,
            delivered_at: a.delivered_at || null,
            incident_at: a.incident_at || null,
            incident_note: a.incident_note || null,
            // Sprint 5: lo que el propio repartidor registró al entregar (sin PII).
            collection: a.collection
                ? {
                    collected_by_driver: (_h = a.collection.collected_by_driver) !== null && _h !== void 0 ? _h : null,
                    method: (_j = a.collection.method) !== null && _j !== void 0 ? _j : null,
                    amount: (_k = a.collection.amount) !== null && _k !== void 0 ? _k : null,
                    at: (_l = a.collection.at) !== null && _l !== void 0 ? _l : null,
                }
                : null,
        },
        business: biz
            ? {
                _id: biz._id,
                name: biz.name || null,
                address: biz.address || null,
                phone: biz.phone || null,
                image_url: biz.image_url || null,
                location: biz.location || null,
                estimated_delivery_minutes: (_o = (_m = biz.delivery_options) === null || _m === void 0 ? void 0 : _m.estimated_delivery_minutes) !== null && _o !== void 0 ? _o : null,
            }
            : { _id: order.bussiness_id, name: null, address: null, phone: null, image_url: null, location: null, estimated_delivery_minutes: null },
    };
}
/** GET /me/driver/orders?scope=pool|mine|history */
function getMyDriverOrders(req, res) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a;
        const ctx = req.hubContext;
        try {
            const raw = String(req.query.scope || "pool");
            const scope = raw === "mine" || raw === "history" ? raw : "pool";
            const [resp, vis, businesses] = yield Promise.all([
                (0, ordersService_external_1.getDriverOrdersExternal)(ctx.hubId, ctx.userId, scope),
                readDriverVisibility(ctx.hubId),
                businessMapFor(ctx.hubId),
            ]);
            const orders = Array.isArray((_a = resp === null || resp === void 0 ? void 0 : resp.data) === null || _a === void 0 ? void 0 : _a.orders) ? resp.data.orders : [];
            return res.status(200).json({
                status: true,
                statusCode: 200,
                message: "Pedidos del repartidor",
                data: { scope, orders: orders.map((o) => driverOrderView(o, vis, businesses)) },
            });
        }
        catch (error) {
            return upstream(res, error, "listar los pedidos del repartidor");
        }
    });
}
/** POST /me/driver/orders/:orderId/claim — toma atómica desde la bolsa. */
function claimMyDriverOrder(req, res) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a;
        const ctx = req.hubContext;
        try {
            const actor = yield actorOf(ctx);
            const resp = yield (0, ordersService_external_1.hubOrderFlowExternal)(ctx.hubId, String(req.params.orderId), {
                action: "claim",
                actor,
                driver: { id: actor.id, name: actor.name },
            });
            const [vis, businesses] = yield Promise.all([readDriverVisibility(ctx.hubId), businessMapFor(ctx.hubId)]);
            if ((_a = resp === null || resp === void 0 ? void 0 : resp.data) === null || _a === void 0 ? void 0 : _a.order)
                resp.data.order = driverOrderView(resp.data.order, vis, businesses);
            return res.status(200).json(resp);
        }
        catch (error) {
            return upstream(res, error, "tomar el pedido");
        }
    });
}
/**
 * PATCH /me/driver/orders/:orderId/status
 * Body: { status: picked_up|on_the_way|delivered|incident, note?, collection? }
 * collection (Sprint 5, solo con 'delivered'): { collected, method?, amount? } —
 * cómo le pagó el cliente; orders lo guarda en delivery_assignment.collection.
 */
function updateMyDriverOrderStatus(req, res) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b, _c, _d;
        const ctx = req.hubContext;
        try {
            const actor = yield actorOf(ctx);
            const status = String(((_a = req.body) === null || _a === void 0 ? void 0 : _a.status) || "");
            const note = typeof ((_b = req.body) === null || _b === void 0 ? void 0 : _b.note) === "string" ? req.body.note.slice(0, 300) : null;
            const collection = sanitizeCollection((_c = req.body) === null || _c === void 0 ? void 0 : _c.collection);
            const resp = yield (0, ordersService_external_1.hubOrderFlowExternal)(ctx.hubId, String(req.params.orderId), Object.assign({ action: "delivery_status", actor,
                status,
                note }, (collection ? { collection } : {})));
            const [vis, businesses] = yield Promise.all([readDriverVisibility(ctx.hubId), businessMapFor(ctx.hubId)]);
            if ((_d = resp === null || resp === void 0 ? void 0 : resp.data) === null || _d === void 0 ? void 0 : _d.order)
                resp.data.order = driverOrderView(resp.data.order, vis, businesses);
            return res.status(200).json(resp);
        }
        catch (error) {
            return upstream(res, error, "actualizar la entrega");
        }
    });
}
