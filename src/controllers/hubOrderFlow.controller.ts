import { Request, Response } from "express";
import hubModel from "../models/hubModel";
import hubUserModel from "../models/hubUserModel";
import { HubContext } from "../utils/auth";
import { hubOrderFlowExternal, getDriverOrdersExternal, HubOrderFlowBody, HubOrderFlowCollection } from "../services/ordersService.external";
import { getBusinessesByHubId } from "../services/businessService.external";

// ════════════════════════════════════════════════════════════════════════════
// Sprint 3 — Flujo del pedido: confirmación del hub, bolsa de repartidores y
// app del repartidor. Este servicio decide QUIÉN puede hacer qué (rol del JWT)
// y qué datos del cliente ve el repartidor (driverVisibility); orders ejecuta
// la máquina de estados y re-valida el scope hub↔pedido.
// ════════════════════════════════════════════════════════════════════════════

function upstream(res: Response, error: any, action: string): Response {
    const st = error?.response?.status;
    if (st && st >= 400 && st < 500 && error?.response?.data) {
        return res.status(st).json(error.response.data);
    }
    console.error(`Error en ${action}:`, error?.response?.data || error?.message || error);
    return res.status(502).json({
        status: false,
        statusCode: 502,
        message: `No se pudo ${action} (orders-service respondió ${st ?? "sin conexión"})`,
        data: {},
    });
}

/** Quién ejecuta la acción (nombre para el historial del pedido). */
async function actorOf(ctx: HubContext): Promise<{ id: string; name: string; role: string }> {
    let name = ctx.email;
    try {
        const u: any = await hubUserModel.findById(ctx.userId).select("name email").lean();
        if (u?.name) name = String(u.name);
        else if (u?.email) name = String(u.email);
    } catch {
        /* el email del token basta */
    }
    return { id: String(ctx.userId), name: String(name || "").slice(0, 80), role: ctx.role };
}

async function runFlow(res: Response, ctx: HubContext, orderId: string, body: Omit<HubOrderFlowBody, "actor">, actionLabel: string) {
    try {
        const actor = await actorOf(ctx);
        const resp = await hubOrderFlowExternal(ctx.hubId, orderId, { ...body, actor });
        return res.status(200).json(resp);
    } catch (error: any) {
        return upstream(res, error, actionLabel);
    }
}

// ── Acciones del hub (HUB_OWNER / HUB_ADMIN / HUB_STAFF) ──

/** POST /me/orders/:orderId/confirm  Body: { publish?: boolean } */
export async function confirmMyHubOrder(req: Request, res: Response): Promise<Response> {
    const ctx = req.hubContext!;
    let publish = req.body?.publish;
    if (typeof publish !== "boolean") {
        const hub: any = await hubModel.findById(ctx.hubId).select("orderFlow").lean();
        publish = hub?.orderFlow?.autoPublishOnConfirm !== false;
    }
    return runFlow(res, ctx, String(req.params.orderId), { action: "confirm", publish }, "confirmar el pedido");
}

/** POST /me/orders/:orderId/reject  Body: { reason?: string } */
export async function rejectMyHubOrder(req: Request, res: Response): Promise<Response> {
    const ctx = req.hubContext!;
    const reason = typeof req.body?.reason === "string" ? req.body.reason.trim().slice(0, 300) : "";
    return runFlow(res, ctx, String(req.params.orderId), { action: "reject", reason }, "rechazar el pedido");
}

/** POST /me/orders/:orderId/publish */
export async function publishMyHubOrder(req: Request, res: Response): Promise<Response> {
    return runFlow(res, req.hubContext!, String(req.params.orderId), { action: "publish" }, "publicar el pedido");
}

/** POST /me/orders/:orderId/unpublish */
export async function unpublishMyHubOrder(req: Request, res: Response): Promise<Response> {
    return runFlow(res, req.hubContext!, String(req.params.orderId), { action: "unpublish" }, "retirar el pedido de la bolsa");
}

/** POST /me/orders/:orderId/assign  Body: { driverId } — el repartidor debe ser de ESTE hub. */
export async function assignMyHubOrder(req: Request, res: Response): Promise<Response> {
    const ctx = req.hubContext!;
    const driverId = String(req.body?.driverId || "");
    if (!/^[0-9a-fA-F]{24}$/.test(driverId)) {
        return res.status(400).json({ status: false, statusCode: 400, message: "driverId es requerido", data: {} });
    }
    const driver: any = await hubUserModel
        .findOne({ _id: driverId, hub_id: ctx.hubId, role: "DELIVERY_DRIVER" })
        .select("name email status")
        .lean();
    if (!driver || driver.status !== "ACTIVE") {
        return res.status(404).json({ status: false, statusCode: 404, message: "Repartidor no encontrado en este hub", data: {} });
    }
    return runFlow(
        res,
        ctx,
        String(req.params.orderId),
        { action: "assign", driver: { id: String(driver._id), name: String(driver.name || driver.email || "") } },
        "asignar el pedido"
    );
}

/** POST /me/orders/:orderId/unassign  Body: { republish?: boolean } (default true) */
export async function unassignMyHubOrder(req: Request, res: Response): Promise<Response> {
    const republish = req.body?.republish !== false;
    return runFlow(res, req.hubContext!, String(req.params.orderId), { action: "unassign", republish }, "liberar el pedido");
}

/** PATCH /me/orders/:orderId/delivery-status  Body: { status, note? } — el hub mueve cualquier pedido. */
export async function updateMyHubOrderDeliveryStatus(req: Request, res: Response): Promise<Response> {
    const status = String(req.body?.status || "");
    const note = typeof req.body?.note === "string" ? req.body.note.slice(0, 300) : null;
    const collection = sanitizeCollection(req.body?.collection);
    return runFlow(
        res,
        req.hubContext!,
        String(req.params.orderId),
        { action: "delivery_status", status, note, ...(collection ? { collection } : {}) },
        "actualizar la entrega"
    );
}

// ── Sprint 5: cobro registrado al entregar ──

/**
 * Sanea body.collection { collected, method?, amount? }. Devuelve null si no es
 * un objeto con `collected` booleano (orders lo trata como "no cobró"). Las
 * reglas de negocio (monto por defecto, payment_status) viven en orders.
 */
function sanitizeCollection(raw: unknown): HubOrderFlowCollection | null {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    const o = raw as Record<string, unknown>;
    if (typeof o.collected !== "boolean") return null;
    const out: HubOrderFlowCollection = { collected: o.collected };
    if (o.method === "cash" || o.method === "wallet" || o.method === "none") out.method = o.method;
    if (typeof o.amount === "number" && Number.isFinite(o.amount) && o.amount > 0) out.amount = Math.round(o.amount * 100) / 100;
    return out;
}

/**
 * PATCH /me/orders/:orderId/collection  Body: { collection: { collected, method?, amount? } }
 * El hub corrige lo que el repartidor registró (o no) al entregar. Solo aplica a
 * pedidos ya entregados (orders lo valida). Responde el pedido actualizado.
 */
export async function setMyHubOrderCollection(req: Request, res: Response): Promise<Response> {
    const collection = sanitizeCollection(req.body?.collection);
    if (!collection) {
        return res.status(400).json({
            status: false,
            statusCode: 400,
            message: "collection es requerido: { collected: boolean, method?: cash|wallet|none, amount?: number }",
            data: {},
        });
    }
    return runFlow(res, req.hubContext!, String(req.params.orderId), { action: "set_collection", collection }, "registrar el cobro");
}

/** GET /me/drivers — repartidores del hub (para asignar a mano y para Usuarios). */
export async function getMyHubDrivers(req: Request, res: Response): Promise<Response> {
    try {
        const ctx = req.hubContext!;
        const drivers = await hubUserModel
            .find({ hub_id: ctx.hubId, role: "DELIVERY_DRIVER" })
            .select("name email phone status created_at")
            .sort({ name: 1, created_at: -1 })
            .lean();
        return res.status(200).json({ status: true, statusCode: 200, message: "Repartidores del hub", data: { drivers } });
    } catch (error) {
        console.error("Error listando repartidores:", error);
        return res.status(500).json({ status: false, statusCode: 500, message: "Error interno del servidor", data: {} });
    }
}

// ── App del repartidor (DELIVERY_DRIVER) ──

interface DriverVisibility {
    customerName: boolean;
    customerPhone: boolean;
}

async function readDriverVisibility(hubId: string): Promise<DriverVisibility> {
    const hub: any = await hubModel.findById(hubId).select("driverVisibility").lean();
    return {
        customerName: hub?.driverVisibility?.customerName !== false,
        customerPhone: hub?.driverVisibility?.customerPhone === true,
    };
}

// Negocios del hub (nombre, dirección, teléfono para la recogida). Caché corta:
// la app refresca cada pocos segundos y los negocios casi no cambian.
const businessCache = new Map<string, { at: number; map: Map<string, any> }>();
async function businessMapFor(hubId: string): Promise<Map<string, any>> {
    const cached = businessCache.get(hubId);
    if (cached && Date.now() - cached.at < 60_000) return cached.map;
    const map = new Map<string, any>();
    try {
        const resp = await getBusinessesByHubId(hubId);
        const list: any[] = resp?.data?.businesses || [];
        for (const b of list) map.set(String(b._id), b);
    } catch (e: any) {
        console.error("[driver] no se pudo leer los negocios del hub:", e?.message);
        if (cached) return cached.map;
    }
    businessCache.set(hubId, { at: Date.now(), map });
    return map;
}

/**
 * Proyección ALLOWLIST del pedido para el repartidor. Del cliente: dirección,
 * referencia y pin siempre; nombre y teléfono según la matriz del hub. Nunca
 * email, comprobante, atribución, comisiones ni auditoría interna.
 */
function driverOrderView(order: any, vis: DriverVisibility, businesses: Map<string, any>) {
    const biz = businesses.get(String(order.bussiness_id)) || null;
    const a = order.delivery_assignment || {};
    const items = Array.isArray(order.items)
        ? order.items.map((it: any) => ({
              quantity: Number(it?.quantity) || 1,
              name: it?.product_details?.name || it?.product?.name || "Producto",
              variants: Array.isArray(it?.product_details?.variants)
                  ? it.product_details.variants
                        .map((v: any) => [v?.variant_name, v?.variant_value].filter(Boolean).join(": "))
                        .filter(Boolean)
                  : [],
              options: Array.isArray(it?.product_details?.options)
                  ? it.product_details.options.map((o: any) => o?.option_name).filter(Boolean)
                  : [],
          }))
        : [];
    return {
        _id: order._id,
        orderNumber: order.orderNumber ?? null,
        created_at: order.created_at,
        order_status: order.order_status,
        delivery_method: order.delivery_method,
        delivery_address: order.delivery_address || null,
        delivery_city: order.delivery_city || null,
        delivery_department: order.delivery_department || null,
        delivery_reference: order.delivery_reference || null,
        delivery_geo: order.delivery_geo || null,
        delivery_distance_km: order.delivery_distance_km ?? null,
        delivery_cost: order.delivery_cost ?? null,
        total_amount: order.total_amount ?? null,
        order_total: order.order_total ?? null,
        payment_type: order.payment_type || order.payment?.payment_method || null,
        payment_status: order.payment_status || order.payment?.payment_status || null,
        order_note: order.order_note || null,
        items,
        items_count: items.reduce((acc: number, it: any) => acc + (Number(it.quantity) || 1), 0),
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
                      collected_by_driver: a.collection.collected_by_driver ?? null,
                      method: a.collection.method ?? null,
                      amount: a.collection.amount ?? null,
                      at: a.collection.at ?? null,
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
                  estimated_delivery_minutes: biz.delivery_options?.estimated_delivery_minutes ?? null,
              }
            : { _id: order.bussiness_id, name: null, address: null, phone: null, image_url: null, location: null, estimated_delivery_minutes: null },
    };
}

/** GET /me/driver/orders?scope=pool|mine|history */
export async function getMyDriverOrders(req: Request, res: Response): Promise<Response> {
    const ctx = req.hubContext!;
    try {
        const raw = String(req.query.scope || "pool");
        const scope = raw === "mine" || raw === "history" ? raw : "pool";
        const [resp, vis, businesses] = await Promise.all([
            getDriverOrdersExternal(ctx.hubId, ctx.userId, scope),
            readDriverVisibility(ctx.hubId),
            businessMapFor(ctx.hubId),
        ]);
        const orders: any[] = Array.isArray(resp?.data?.orders) ? resp.data.orders : [];
        return res.status(200).json({
            status: true,
            statusCode: 200,
            message: "Pedidos del repartidor",
            data: { scope, orders: orders.map((o) => driverOrderView(o, vis, businesses)) },
        });
    } catch (error: any) {
        return upstream(res, error, "listar los pedidos del repartidor");
    }
}

/** POST /me/driver/orders/:orderId/claim — toma atómica desde la bolsa. */
export async function claimMyDriverOrder(req: Request, res: Response): Promise<Response> {
    const ctx = req.hubContext!;
    try {
        const actor = await actorOf(ctx);
        const resp = await hubOrderFlowExternal(ctx.hubId, String(req.params.orderId), {
            action: "claim",
            actor,
            driver: { id: actor.id, name: actor.name },
        });
        const [vis, businesses] = await Promise.all([readDriverVisibility(ctx.hubId), businessMapFor(ctx.hubId)]);
        if (resp?.data?.order) resp.data.order = driverOrderView(resp.data.order, vis, businesses);
        return res.status(200).json(resp);
    } catch (error: any) {
        return upstream(res, error, "tomar el pedido");
    }
}

/**
 * PATCH /me/driver/orders/:orderId/status
 * Body: { status: picked_up|on_the_way|delivered|incident, note?, collection? }
 * collection (Sprint 5, solo con 'delivered'): { collected, method?, amount? } —
 * cómo le pagó el cliente; orders lo guarda en delivery_assignment.collection.
 */
export async function updateMyDriverOrderStatus(req: Request, res: Response): Promise<Response> {
    const ctx = req.hubContext!;
    try {
        const actor = await actorOf(ctx);
        const status = String(req.body?.status || "");
        const note = typeof req.body?.note === "string" ? req.body.note.slice(0, 300) : null;
        const collection = sanitizeCollection(req.body?.collection);
        const resp = await hubOrderFlowExternal(ctx.hubId, String(req.params.orderId), {
            action: "delivery_status",
            actor,
            status,
            note,
            ...(collection ? { collection } : {}),
        });
        const [vis, businesses] = await Promise.all([readDriverVisibility(ctx.hubId), businessMapFor(ctx.hubId)]);
        if (resp?.data?.order) resp.data.order = driverOrderView(resp.data.order, vis, businesses);
        return res.status(200).json(resp);
    } catch (error: any) {
        return upstream(res, error, "actualizar la entrega");
    }
}
