import { Request, Response } from "express";
import { Types } from "mongoose";
import hubModel from "../models/hubModel";
import hubUserModel from "../models/hubUserModel";
import hubDriverSettlementModel from "../models/hubDriverSettlementModel";
import { getDriverSettlementLines, DriverSettlementLineExternal, DriverSettlementLinesData } from "../services/ordersService.external";
import { getBusinessesByHubId } from "../services/businessService.external";
import { detectPeriodFrequency, periodRangeInTz, currentPeriodKey, round2 } from "../utils/settlementPeriods";
import { resolveDriverPayConfig, resolveDriverPayRule, computeDriverCommission, DriverPayRule } from "../utils/driverPay";
import { HubContext } from "../utils/auth";

// ════════════════════════════════════════════════════════════════════════════
// Sprint 5 — Liquidación de repartidores (reemplaza el Excel del courier).
//
// Por período y repartidor: entregas, lo que cobró al cliente (efectivo /
// billetera), su comisión según la regla del hub (o su override) y ajustes
// (bonos + / descuentos −). netToHub > 0 = el repartidor le entrega dinero al
// hub; < 0 = el hub le paga. Ordena NO mueve el dinero: solo registra y marca
// "Pagada". Las liquidaciones PAGADAS jamás se recalculan.
// ════════════════════════════════════════════════════════════════════════════

const OBJECT_ID = /^[0-9a-fA-F]{24}$/;
const DEFAULT_TZ = "America/El_Salvador";
const PERIOD_HELP = "period inválido: usa YYYY-MM-DD (diario), YYYY-Www (semanal), YYYY-MM-Q1|Q2 (quincenal) o YYYY-MM (mensual)";

function fail(res: Response, statusCode: number, message: string): Response {
    return res.status(statusCode).json({ status: false, statusCode, message, data: {} });
}

/** Errores 4xx de orders se propagan tal cual; lo demás es 502 (mismo patrón que hubOrderFlow). */
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

/** Quién ejecuta la acción (nombre o email) para paidBy / createdBy. */
async function actorLabel(ctx: HubContext): Promise<string> {
    let label = ctx.email;
    try {
        const u: any = await hubUserModel.findById(ctx.userId).select("name email").lean();
        if (u?.name) label = String(u.name);
        else if (u?.email) label = String(u.email);
    } catch {
        /* el email del token basta */
    }
    return String(label || "").slice(0, 120);
}

const num = (v: unknown, fallback = 0): number => (typeof v === "number" && Number.isFinite(v) ? v : fallback);

interface SettlementLine {
    orderId: string;
    orderNumber: number | null;
    businessId: string;
    businessName: string | null;
    deliveredAt: Date | null;
    orderTotal: number;
    deliveryCost: number;
    distanceKm: number | null;
    paymentType: string | null;
    collectedByDriver: boolean;
    collectedMethod: string | null;
    collectedAmount: number;
    commissionAmount: number;
}

/** Línea de orders → línea de la liquidación (con nombre del negocio y comisión). */
function buildLine(raw: DriverSettlementLineExternal, rule: DriverPayRule, businessNames: Map<string, string>): SettlementLine {
    const orderTotal = round2(num(raw?.orderTotal));
    const deliveryCost = round2(num(raw?.deliveryCost));
    const collectedByDriver = raw?.collectedByDriver === true;
    const deliveredAt = raw?.deliveredAt ? new Date(raw.deliveredAt) : null;
    return {
        orderId: String(raw?.orderId || ""),
        orderNumber: typeof raw?.orderNumber === "number" ? raw.orderNumber : null,
        businessId: String(raw?.businessId || ""),
        businessName: businessNames.get(String(raw?.businessId || "")) || null,
        deliveredAt: deliveredAt && !isNaN(deliveredAt.getTime()) ? deliveredAt : null,
        orderTotal,
        deliveryCost,
        distanceKm: typeof raw?.distanceKm === "number" && Number.isFinite(raw.distanceKm) ? raw.distanceKm : null,
        paymentType: raw?.paymentType ? String(raw.paymentType) : null,
        collectedByDriver,
        collectedMethod: raw?.collectedMethod ? String(raw.collectedMethod) : null,
        collectedAmount: collectedByDriver ? round2(num(raw?.collectedAmount)) : 0,
        commissionAmount: computeDriverCommission(rule, { orderTotal, deliveryCost }),
    };
}

interface PeriodTotals {
    deliveriesCount: number;
    collectedTotal: number;
    deliveryFeesTotal: number;
    orderTotalsTotal: number;
    commissionAmount: number;
}

/**
 * Totales del período a partir de la respuesta de orders. Los agregados vienen
 * de orders (cubren TODO el rango aunque las líneas estén truncadas); la
 * comisión sale de las líneas — salvo 'fixed', que se calcula sobre el conteo
 * total para no perder entregas si hubo truncado.
 */
function summarize(data: Partial<DriverSettlementLinesData> | undefined, lines: SettlementLine[], rule: DriverPayRule): PeriodTotals {
    const deliveriesCount = typeof data?.deliveriesCount === "number" && Number.isFinite(data.deliveriesCount) ? data.deliveriesCount : lines.length;
    const collectedTotal = round2(
        typeof data?.collectedTotal === "number" && Number.isFinite(data.collectedTotal)
            ? data.collectedTotal
            : lines.reduce((acc, l) => acc + (l.collectedByDriver ? l.collectedAmount : 0), 0)
    );
    const deliveryFeesTotal = round2(
        typeof data?.deliveryFeesTotal === "number" && Number.isFinite(data.deliveryFeesTotal)
            ? data.deliveryFeesTotal
            : lines.reduce((acc, l) => acc + l.deliveryCost, 0)
    );
    const orderTotalsTotal = round2(
        typeof data?.orderTotalsTotal === "number" && Number.isFinite(data.orderTotalsTotal)
            ? data.orderTotalsTotal
            : lines.reduce((acc, l) => acc + l.orderTotal, 0)
    );
    const commissionAmount =
        rule.commissionType === "fixed"
            ? round2(deliveriesCount * rule.commissionValue)
            : round2(lines.reduce((acc, l) => acc + l.commissionAmount, 0));
    return { deliveriesCount, collectedTotal, deliveryFeesTotal, orderTotalsTotal, commissionAmount };
}

interface Adjustment {
    id: string;
    concept: string;
    amount: number;
    createdBy: string | null;
    createdAt: Date;
}

/** adjustmentsTotal / driverEarnings / netToHub a partir de cobrado, comisión y ajustes. */
function recalc(collectedTotal: number, commissionAmount: number, adjustments: Adjustment[]) {
    const adjustmentsTotal = round2(adjustments.reduce((acc, a) => acc + num(a?.amount), 0));
    const driverEarnings = round2(commissionAmount + adjustmentsTotal);
    const netToHub = round2(collectedTotal - driverEarnings);
    return { adjustmentsTotal, driverEarnings, netToHub };
}

/** Nombres de los negocios del hub (una sola llamada; best-effort: sin nombre no se frena la liquidación). */
async function businessNamesFor(hubId: string): Promise<Map<string, string>> {
    const map = new Map<string, string>();
    try {
        const resp = await getBusinessesByHubId(hubId);
        for (const b of resp?.data?.businesses || []) map.set(String(b._id), String(b.name || ""));
    } catch (e: any) {
        console.error("[driver-settlements] no se pudieron leer los negocios del hub:", e?.message);
    }
    return map;
}

// ── Hub (HUB_OWNER / HUB_ADMIN) ──

/**
 * POST /api/hubs/me/driver-settlements/generate
 * Body: { period, driverId? }. Genera (o RE-genera mientras no esté PAID) la
 * liquidación del período para un repartidor o para todos los del hub. Las
 * líneas salen de orders (entregas del repartidor con su cobro); la comisión,
 * de la regla del hub o del override del repartidor. Los ajustes de una
 * liquidación PENDIENTE se conservan al regenerar.
 */
export async function generateMyDriverSettlements(req: Request, res: Response): Promise<Response> {
    const ctx = req.hubContext!;
    try {
        const period = String(req.body?.period || "").trim();
        if (!detectPeriodFrequency(period)) return fail(res, 400, PERIOD_HELP);
        const requestedDriverId = req.body?.driverId ? String(req.body.driverId).trim() : null;
        if (requestedDriverId && !OBJECT_ID.test(requestedDriverId)) return fail(res, 400, "driverId inválido");

        const hub: any = await hubModel
            .findById(ctx.hubId)
            .select("timezone currency driverPayConfig driverCommissionOverrides")
            .lean();
        if (!hub) return fail(res, 404, "Hub no encontrado");
        const { start, end, frequency } = periodRangeInTz(period, hub.timezone || DEFAULT_TZ);

        const driverFilter: Record<string, unknown> = { hub_id: ctx.hubId, role: "DELIVERY_DRIVER" };
        if (requestedDriverId) driverFilter._id = requestedDriverId;
        const drivers: any[] = await hubUserModel.find(driverFilter).select("name email").sort({ name: 1, created_at: 1 }).lean();
        if (requestedDriverId && drivers.length === 0) return fail(res, 404, "Repartidor no encontrado en este hub");
        if (drivers.length === 0) return fail(res, 400, "El hub no tiene repartidores");

        const businessNames = await businessNamesFor(ctx.hubId);

        const results: any[] = [];
        const skippedPaid: string[] = [];
        for (const driver of drivers) {
            const driverId = String(driver._id);
            const existing: any = await hubDriverSettlementModel
                .findOne({ hubId: ctx.hubId, driverId, period })
                .select("status adjustments")
                .lean();
            if (existing?.status === "PAID") {
                // Una liquidación pagada es un documento histórico: jamás se pisa.
                skippedPaid.push(driverId);
                continue;
            }

            const linesResp = await getDriverSettlementLines(ctx.hubId, driverId, start.toISOString(), end.toISOString());
            const data = (linesResp?.data || {}) as Partial<DriverSettlementLinesData>;
            const rule = resolveDriverPayRule(hub, driverId);
            const lines = (Array.isArray(data.lines) ? data.lines : []).map((l) => buildLine(l, rule, businessNames));
            const totals = summarize(data, lines, rule);
            const adjustments: Adjustment[] = Array.isArray(existing?.adjustments) ? existing.adjustments : [];
            const derived = recalc(totals.collectedTotal, totals.commissionAmount, adjustments);

            const now = new Date();
            const doc = await hubDriverSettlementModel
                .findOneAndUpdate(
                    { hubId: ctx.hubId, driverId, period, status: { $ne: "PAID" } },
                    {
                        $set: {
                            driverName: driver.name ? String(driver.name) : driver.email ? String(driver.email) : null,
                            driverEmail: driver.email ? String(driver.email) : null,
                            frequency,
                            periodStart: start,
                            periodEnd: end,
                            deliveriesCount: totals.deliveriesCount,
                            collectedTotal: totals.collectedTotal,
                            deliveryFeesTotal: totals.deliveryFeesTotal,
                            orderTotalsTotal: totals.orderTotalsTotal,
                            commissionType: rule.commissionType,
                            commissionValue: rule.commissionValue,
                            percentBase: rule.percentBase,
                            commissionAmount: totals.commissionAmount,
                            adjustments,
                            adjustmentsTotal: derived.adjustmentsTotal,
                            driverEarnings: derived.driverEarnings,
                            netToHub: derived.netToHub,
                            currency: hub.currency || "USD",
                            lines,
                            linesTruncated: !!data.truncated,
                            status: "PENDING",
                            generatedAt: now,
                            updated_at: now,
                        },
                        $setOnInsert: { created_at: now },
                    },
                    { upsert: true, new: true, setDefaultsOnInsert: true }
                )
                .select("-lines")
                .lean();
            results.push(doc);
        }

        return res.status(200).json({
            status: true,
            statusCode: 200,
            message: `Liquidaciones de repartidores generadas (${results.length})${skippedPaid.length ? ` — ${skippedPaid.length} ya pagadas, intactas` : ""}`,
            data: { settlements: results, skippedPaid },
        });
    } catch (error: any) {
        return upstream(res, error, "generar las liquidaciones de repartidores");
    }
}

/** GET /api/hubs/me/driver-settlements?period=&driverId=  (HUB_OWNER / HUB_ADMIN) — sin líneas. */
export async function listMyDriverSettlements(req: Request, res: Response): Promise<Response> {
    const ctx = req.hubContext!;
    try {
        const filter: Record<string, unknown> = { hubId: ctx.hubId };
        if (typeof req.query.period === "string" && req.query.period.trim()) filter.period = req.query.period.trim();
        if (typeof req.query.driverId === "string" && req.query.driverId.trim()) filter.driverId = req.query.driverId.trim();
        const settlements = await hubDriverSettlementModel
            .find(filter)
            .select("-lines")
            .sort({ period: -1, driverName: 1 })
            .limit(200)
            .lean();
        return res.status(200).json({ status: true, statusCode: 200, message: "Liquidaciones de repartidores", data: { settlements } });
    } catch (error) {
        console.error("Error listando liquidaciones de repartidores:", error);
        return fail(res, 500, "Error interno del servidor");
    }
}

/**
 * GET /api/hubs/me/driver-settlements/:id  (HUB_OWNER / HUB_ADMIN, y el DELIVERY_DRIVER dueño)
 * Con líneas (sin PII: nunca llevaron datos del cliente).
 */
export async function getMyDriverSettlementDetail(req: Request, res: Response): Promise<Response> {
    const ctx = req.hubContext!;
    try {
        const id = String(req.params.id || "");
        if (!OBJECT_ID.test(id)) return fail(res, 404, "Liquidación no encontrada");
        const doc: any = await hubDriverSettlementModel.findOne({ _id: id, hubId: ctx.hubId }).lean();
        if (!doc) return fail(res, 404, "Liquidación no encontrada");
        if (ctx.role === "DELIVERY_DRIVER" && String(doc.driverId) !== String(ctx.userId)) {
            return fail(res, 403, "No tienes acceso a esta liquidación");
        }
        return res.status(200).json({ status: true, statusCode: 200, message: "Liquidación", data: { settlement: doc } });
    } catch (error) {
        console.error("Error leyendo liquidación de repartidor:", error);
        return fail(res, 500, "Error interno del servidor");
    }
}

/**
 * PATCH /api/hubs/me/driver-settlements/:id/paid  (HUB_OWNER / HUB_ADMIN)
 * Body: { reference? }. El dinero se movió POR FUERA; aquí solo queda el registro.
 * Idempotente: si ya estaba PAID responde 200 con el documento tal cual.
 */
export async function markMyDriverSettlementPaid(req: Request, res: Response): Promise<Response> {
    const ctx = req.hubContext!;
    try {
        const id = String(req.params.id || "");
        if (!OBJECT_ID.test(id)) return fail(res, 404, "Liquidación no encontrada");
        const reference = typeof req.body?.reference === "string" ? req.body.reference.trim().slice(0, 200) || null : null;

        const current: any = await hubDriverSettlementModel.findOne({ _id: id, hubId: ctx.hubId }).lean();
        if (!current) return fail(res, 404, "Liquidación no encontrada");
        if (current.status === "PAID") {
            return res.status(200).json({ status: true, statusCode: 200, message: "La liquidación ya estaba pagada", data: { settlement: current } });
        }

        const now = new Date();
        const paidBy = await actorLabel(ctx);
        let doc: any = await hubDriverSettlementModel
            .findOneAndUpdate(
                { _id: id, hubId: ctx.hubId, status: "PENDING" },
                { $set: { status: "PAID", paidAt: now, paidReference: reference, paidBy, updated_at: now } },
                { new: true }
            )
            .lean();
        if (!doc) {
            // Carrera: alguien la pagó entre la lectura y el update → idempotente.
            doc = await hubDriverSettlementModel.findOne({ _id: id, hubId: ctx.hubId }).lean();
            if (!doc) return fail(res, 404, "Liquidación no encontrada");
        }
        return res.status(200).json({ status: true, statusCode: 200, message: "Liquidación marcada como pagada", data: { settlement: doc } });
    } catch (error) {
        console.error("Error marcando liquidación de repartidor:", error);
        return fail(res, 500, "Error interno del servidor");
    }
}

/**
 * POST /api/hubs/me/driver-settlements/:id/adjustments  (HUB_OWNER / HUB_ADMIN)
 * Body: { concept (1–120), amount (≠ 0; positivo = bono, negativo = descuento) }.
 * 409 si la liquidación ya está pagada. Recalcula adjustmentsTotal/driverEarnings/netToHub.
 */
export async function addMyDriverSettlementAdjustment(req: Request, res: Response): Promise<Response> {
    const ctx = req.hubContext!;
    try {
        const id = String(req.params.id || "");
        if (!OBJECT_ID.test(id)) return fail(res, 404, "Liquidación no encontrada");
        const concept = typeof req.body?.concept === "string" ? req.body.concept.trim() : "";
        if (concept.length < 1 || concept.length > 120) return fail(res, 400, "concept es requerido (1 a 120 caracteres)");
        const rawAmount = req.body?.amount;
        const amount = typeof rawAmount === "number" && Number.isFinite(rawAmount) ? round2(rawAmount) : NaN;
        if (!Number.isFinite(amount) || amount === 0) return fail(res, 400, "amount debe ser un número distinto de 0");

        const current: any = await hubDriverSettlementModel.findOne({ _id: id, hubId: ctx.hubId }).lean();
        if (!current) return fail(res, 404, "Liquidación no encontrada");
        if (current.status === "PAID") return fail(res, 409, "La liquidación ya está pagada: no admite ajustes");

        const now = new Date();
        const adjustment: Adjustment = {
            id: new Types.ObjectId().toString(),
            concept,
            amount,
            createdBy: await actorLabel(ctx),
            createdAt: now,
        };
        const adjustments: Adjustment[] = [...(Array.isArray(current.adjustments) ? current.adjustments : []), adjustment];
        const derived = recalc(num(current.collectedTotal), num(current.commissionAmount), adjustments);

        const doc: any = await hubDriverSettlementModel
            .findOneAndUpdate(
                { _id: id, hubId: ctx.hubId, status: "PENDING" },
                { $set: { adjustments, ...derived, updated_at: now } },
                { new: true }
            )
            .lean();
        if (!doc) return fail(res, 409, "La liquidación ya está pagada: no admite ajustes");
        return res.status(200).json({ status: true, statusCode: 200, message: "Ajuste agregado", data: { settlement: doc, adjustment } });
    } catch (error) {
        console.error("Error agregando ajuste:", error);
        return fail(res, 500, "Error interno del servidor");
    }
}

/**
 * DELETE /api/hubs/me/driver-settlements/:id/adjustments/:adjustmentId  (HUB_OWNER / HUB_ADMIN)
 * 409 si la liquidación ya está pagada. Recalcula totales.
 */
export async function removeMyDriverSettlementAdjustment(req: Request, res: Response): Promise<Response> {
    const ctx = req.hubContext!;
    try {
        const id = String(req.params.id || "");
        const adjustmentId = String(req.params.adjustmentId || "");
        if (!OBJECT_ID.test(id)) return fail(res, 404, "Liquidación no encontrada");

        const current: any = await hubDriverSettlementModel.findOne({ _id: id, hubId: ctx.hubId }).lean();
        if (!current) return fail(res, 404, "Liquidación no encontrada");
        if (current.status === "PAID") return fail(res, 409, "La liquidación ya está pagada: no admite ajustes");

        const before: Adjustment[] = Array.isArray(current.adjustments) ? current.adjustments : [];
        const adjustments = before.filter((a) => String(a?.id) !== adjustmentId);
        if (adjustments.length === before.length) return fail(res, 404, "Ajuste no encontrado");
        const derived = recalc(num(current.collectedTotal), num(current.commissionAmount), adjustments);

        const now = new Date();
        const doc: any = await hubDriverSettlementModel
            .findOneAndUpdate(
                { _id: id, hubId: ctx.hubId, status: "PENDING" },
                { $set: { adjustments, ...derived, updated_at: now } },
                { new: true }
            )
            .lean();
        if (!doc) return fail(res, 409, "La liquidación ya está pagada: no admite ajustes");
        return res.status(200).json({ status: true, statusCode: 200, message: "Ajuste eliminado", data: { settlement: doc } });
    } catch (error) {
        console.error("Error eliminando ajuste:", error);
        return fail(res, 500, "Error interno del servidor");
    }
}

// ── App del repartidor (DELIVERY_DRIVER) ──

/**
 * GET /api/hubs/me/driver/account
 * "Mi cuenta" del repartidor: hoy y el período de corte actual (entregas, cobrado,
 * comisión y neto contra el hub, en vivo desde orders), la regla que le aplica y
 * sus últimas 12 liquidaciones (sin líneas). Solo SUS datos (driverId = JWT).
 */
export async function getMyDriverAccount(req: Request, res: Response): Promise<Response> {
    const ctx = req.hubContext!;
    try {
        const hub: any = await hubModel
            .findById(ctx.hubId)
            .select("timezone currency driverPayConfig driverCommissionOverrides")
            .lean();
        if (!hub) return fail(res, 404, "Hub no encontrado");
        const tz = hub.timezone || DEFAULT_TZ;
        const cfg = resolveDriverPayConfig(hub);
        const rule = resolveDriverPayRule(hub, ctx.userId);
        const now = new Date();

        const todayKey = currentPeriodKey("daily", tz, now);
        const todayRange = periodRangeInTz(todayKey, tz);
        const currentKey = currentPeriodKey(cfg.frequency, tz, now);
        const currentRange = periodRangeInTz(currentKey, tz);
        const sameRange = cfg.frequency === "daily";

        const noNames = new Map<string, string>();
        const [todayResp, currentResp] = await Promise.all([
            getDriverSettlementLines(ctx.hubId, ctx.userId, todayRange.start.toISOString(), todayRange.end.toISOString()),
            sameRange
                ? Promise.resolve(null)
                : getDriverSettlementLines(ctx.hubId, ctx.userId, currentRange.start.toISOString(), currentRange.end.toISOString()),
        ]);

        const block = (resp: { data?: Partial<DriverSettlementLinesData> } | null) => {
            const data = (resp?.data || {}) as Partial<DriverSettlementLinesData>;
            const lines = (Array.isArray(data.lines) ? data.lines : []).map((l) => buildLine(l, rule, noNames));
            const t = summarize(data, lines, rule);
            return {
                deliveries: t.deliveriesCount,
                collected: t.collectedTotal,
                commission: t.commissionAmount,
                netToHub: round2(t.collectedTotal - t.commissionAmount),
            };
        };
        const todayBlock = block(todayResp);
        const currentBlock = sameRange ? todayBlock : block(currentResp);

        const settlements = await hubDriverSettlementModel
            .find({ hubId: ctx.hubId, driverId: ctx.userId })
            .select("period frequency status deliveriesCount collectedTotal commissionAmount adjustmentsTotal driverEarnings netToHub paidAt paidReference currency")
            .sort({ period: -1 })
            .limit(12)
            .lean();

        return res.status(200).json({
            status: true,
            statusCode: 200,
            message: "Cuenta del repartidor",
            data: {
                today: { period: todayKey, ...todayBlock },
                currentPeriod: { period: currentKey, frequency: cfg.frequency, ...currentBlock },
                rule: {
                    commissionType: rule.commissionType,
                    commissionValue: rule.commissionValue,
                    percentBase: rule.percentBase,
                    frequency: cfg.frequency,
                },
                settlements,
                currency: hub.currency || "USD",
                timezone: tz,
            },
        });
    } catch (error: any) {
        return upstream(res, error, "leer la cuenta del repartidor");
    }
}
