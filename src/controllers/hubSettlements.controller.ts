import { Request, Response } from "express";
import hubModel from "../models/hubModel";
import hubSettlementModel from "../models/hubSettlementModel";
import { getHubSettlementLines, } from "../services/ordersService.external";
import { getBusinessesByHubId, assertBusinessBelongsToHub } from "../services/businessService.external";

export type SettlementFrequency = "daily" | "weekly" | "biweekly" | "monthly";

const PERIOD_PATTERNS: Record<SettlementFrequency, RegExp> = {
    daily: /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/,
    weekly: /^\d{4}-W(0[1-9]|[1-4]\d|5[0-3])$/,
    biweekly: /^\d{4}-(0[1-9]|1[0-2])-Q[12]$/,
    monthly: /^\d{4}-(0[1-9]|1[0-2])$/,
};

/** Frecuencia implícita en la clave del período (null si el formato no es válido). */
export function detectPeriodFrequency(period: string): SettlementFrequency | null {
    for (const key of Object.keys(PERIOD_PATTERNS) as SettlementFrequency[]) {
        if (PERIOD_PATTERNS[key].test(period)) return key;
    }
    return null;
}

// Offset de la zona en ese instante (técnica estándar sin librerías de TZ).
function tzOffsetMs(utcGuess: Date, tz: string): number {
    const local = new Date(utcGuess.toLocaleString("en-US", { timeZone: tz }));
    const utc = new Date(utcGuess.toLocaleString("en-US", { timeZone: "UTC" }));
    return utc.getTime() - local.getTime();
}

/** Medianoche local (en la TZ del hub) de una fecha civil, expresada en UTC. Acepta desbordes de día/mes. */
function localMidnightUtc(year: number, monthIndex: number, day: number, tz: string): Date {
    const guess = new Date(Date.UTC(year, monthIndex, day));
    return new Date(guess.getTime() + tzOffsetMs(guess, tz));
}

/** Lunes (fecha civil UTC) de la semana ISO `week` del año `year`. */
function isoWeekMonday(year: number, week: number): { year: number; monthIndex: number; day: number } {
    const jan4 = new Date(Date.UTC(year, 0, 4));
    const jan4Weekday = (jan4.getUTCDay() + 6) % 7; // lunes = 0
    const monday = new Date(jan4.getTime() - jan4Weekday * 86400000 + (week - 1) * 7 * 86400000);
    return { year: monday.getUTCFullYear(), monthIndex: monday.getUTCMonth(), day: monday.getUTCDate() };
}

/**
 * Rango [inicio, fin] en UTC de un período según su clave, con el corte en la zona
 * horaria del HUB (que el pedido de las 11pm del último día caiga en el período que
 * el operador vive, no en UTC). Semana = lunes a domingo; quincena = 1–15 y 16–fin.
 */
function periodRangeInTz(period: string, tz: string): { start: Date; end: Date; frequency: SettlementFrequency } {
    const frequency = detectPeriodFrequency(period);
    if (!frequency) throw new Error("PERIOD_INVALID");
    let start: Date;
    let endExclusive: Date;
    if (frequency === "daily") {
        const [y, m, d] = period.split("-").map((n) => parseInt(n, 10));
        start = localMidnightUtc(y, m - 1, d, tz);
        endExclusive = localMidnightUtc(y, m - 1, d + 1, tz);
    } else if (frequency === "weekly") {
        const [ys, ws] = period.split("-W");
        const monday = isoWeekMonday(parseInt(ys, 10), parseInt(ws, 10));
        start = localMidnightUtc(monday.year, monday.monthIndex, monday.day, tz);
        endExclusive = localMidnightUtc(monday.year, monday.monthIndex, monday.day + 7, tz);
    } else if (frequency === "biweekly") {
        const [ys, ms, q] = period.split("-");
        const y = parseInt(ys, 10);
        const m0 = parseInt(ms, 10) - 1;
        if (q === "Q1") {
            start = localMidnightUtc(y, m0, 1, tz);
            endExclusive = localMidnightUtc(y, m0, 16, tz);
        } else {
            start = localMidnightUtc(y, m0, 16, tz);
            endExclusive = localMidnightUtc(y, m0 + 1, 1, tz);
        }
    } else {
        const [y, m] = period.split("-").map((n) => parseInt(n, 10));
        start = localMidnightUtc(y, m - 1, 1, tz);
        endExclusive = localMidnightUtc(y, m, 1, tz);
    }
    return { start, end: new Date(endExclusive.getTime() - 1), frequency };
}

function resolveCommission(
    hub: any,
    businessId: string
): { type: "percent" | "fixed" | "none"; value: number } {
    const override = (hub.commissionOverrides || []).find(
        (o: any) => String(o.businessId) === String(businessId)
    );
    const cfg = override || hub.settlementConfig || {};
    const type = ["percent", "fixed", "none"].includes(cfg.commissionType) ? cfg.commissionType : "percent";
    const value = typeof cfg.commissionValue === "number" && cfg.commissionValue >= 0 ? cfg.commissionValue : 0;
    return { type, value };
}

function round2(n: number): number {
    return Math.round(n * 100) / 100;
}

/**
 * POST /api/hubs/me/settlements/generate  (HUB_OWNER / HUB_ADMIN)
 * Body: { period, businessId? } — period según la frecuencia del hub:
 * YYYY-MM-DD (diaria) · YYYY-Www (semanal, lunes a domingo) · YYYY-MM-Q1|Q2
 * (quincenal) · YYYY-MM (mensual). Cualquier formato válido se acepta, así una
 * liquidación mensual antigua se puede regenerar aunque el hub ya corte semanal.
 * Genera (o RE-genera, mientras no esté PAID) la liquidación del período para
 * un negocio o para todos los del hub. La cifra sale de re-contar orders
 * (entregados y pagados); la comisión, del override del negocio o del default.
 */
export async function generateMySettlements(req: Request, res: Response): Promise<Response> {
    const ctx = req.hubContext!;
    try {
        const period = String(req.body?.period || "").trim();
        if (!detectPeriodFrequency(period)) {
            return res.status(400).json({
                status: false,
                statusCode: 400,
                message: "period inválido: usa YYYY-MM-DD (diario), YYYY-Www (semanal), YYYY-MM-Q1|Q2 (quincenal) o YYYY-MM (mensual)",
                data: {},
            });
        }
        const requestedBusinessId = req.body?.businessId ? String(req.body.businessId) : null;

        const hub: any = await hubModel
            .findById(ctx.hubId)
            .select("timezone currency settlementConfig commissionOverrides")
            .lean();
        if (!hub) {
            return res.status(404).json({ status: false, statusCode: 404, message: "Hub no encontrado", data: {} });
        }
        const { start, end, frequency } = periodRangeInTz(period, hub.timezone || "America/El_Salvador");

        // Universo de negocios a liquidar
        let businesses: Array<{ _id: string; name?: string }> = [];
        if (requestedBusinessId) {
            const biz = await assertBusinessBelongsToHub(ctx.hubId, requestedBusinessId);
            businesses = [{ _id: requestedBusinessId, name: (biz as any)?.name }];
        } else {
            const resp = await getBusinessesByHubId(ctx.hubId);
            businesses = (resp?.data?.businesses || []).map((b: any) => ({ _id: String(b._id), name: b.name }));
        }
        if (businesses.length === 0) {
            return res.status(400).json({ status: false, statusCode: 400, message: "El hub no tiene negocios", data: {} });
        }

        const results: any[] = [];
        const skippedPaid: string[] = [];
        for (const biz of businesses) {
            const existing: any = await hubSettlementModel
                .findOne({ hubId: ctx.hubId, businessId: biz._id, period })
                .select("status")
                .lean();
            if (existing?.status === "PAID") {
                // Una liquidación pagada es un documento histórico: jamás se pisa.
                skippedPaid.push(biz._id);
                continue;
            }

            const linesResp = await getHubSettlementLines(ctx.hubId, biz._id, start.toISOString(), end.toISOString());
            const data = linesResp?.data || {};
            const grossSales = round2(Number(data.grossSales) || 0);
            const ordersCount = Number(data.ordersCount) || 0;

            const commission = resolveCommission(hub, biz._id);
            let commissionAmount = 0;
            if (commission.type === "percent") commissionAmount = round2((grossSales * commission.value) / 100);
            else if (commission.type === "fixed") commissionAmount = round2(ordersCount * commission.value);
            const netPayable = round2(grossSales - commissionAmount);

            const now = new Date();
            const doc = await hubSettlementModel.findOneAndUpdate(
                { hubId: ctx.hubId, businessId: biz._id, period, status: { $ne: "PAID" } },
                {
                    $set: {
                        businessName: biz.name || null,
                        frequency,
                        periodStart: start,
                        periodEnd: end,
                        ordersCount,
                        grossSales,
                        commissionType: commission.type,
                        commissionValue: commission.value,
                        commissionAmount,
                        netPayable,
                        currency: hub.currency || "USD",
                        lines: Array.isArray(data.lines) ? data.lines : [],
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
            message: `Liquidaciones generadas (${results.length})${skippedPaid.length ? ` — ${skippedPaid.length} ya pagadas, intactas` : ""}`,
            data: { settlements: results, skippedPaid },
        });
    } catch (error: any) {
        if (error?.code === "BUSINESS_NOT_IN_HUB") {
            return res.status(403).json({ status: false, statusCode: 403, message: "El negocio no pertenece a este hub", data: {} });
        }
        console.error("Error generando liquidaciones:", error?.response?.data || error?.message || error);
        return res.status(502).json({
            status: false,
            statusCode: 502,
            message: "No se pudieron generar las liquidaciones",
            data: {},
        });
    }
}

/** GET /api/hubs/me/settlements?period=&businessId=  (HUB_OWNER/ADMIN/STAFF) */
export async function listMySettlements(req: Request, res: Response): Promise<Response> {
    const ctx = req.hubContext!;
    try {
        const filter: Record<string, unknown> = { hubId: ctx.hubId };
        if (typeof req.query.period === "string" && req.query.period.trim()) filter.period = req.query.period.trim();
        if (typeof req.query.businessId === "string" && req.query.businessId.trim()) filter.businessId = req.query.businessId.trim();
        const settlements = await hubSettlementModel
            .find(filter)
            .select("-lines")
            .sort({ period: -1, businessName: 1 })
            .limit(200)
            .lean();
        return res.status(200).json({ status: true, statusCode: 200, message: "Liquidaciones", data: { settlements } });
    } catch (error) {
        console.error("Error listando liquidaciones:", error);
        return res.status(500).json({ status: false, statusCode: 500, message: "Error interno del servidor", data: {} });
    }
}

/**
 * GET /api/hubs/me/settlements/:id  (roles de hub, O el BUSINESS_VIEWER dueño)
 * Incluye las líneas (sin PII: nunca llevaron datos del cliente).
 */
export async function getMySettlementDetail(req: Request, res: Response): Promise<Response> {
    const ctx = req.hubContext!;
    try {
        const doc: any = await hubSettlementModel.findOne({ _id: String(req.params.id), hubId: ctx.hubId }).lean();
        if (!doc) {
            return res.status(404).json({ status: false, statusCode: 404, message: "Liquidación no encontrada", data: {} });
        }
        if (ctx.role === "HUB_STAFF") {
            return res.status(403).json({ status: false, statusCode: 403, message: "No tienes permisos para esta acción", data: {} });
        }
        if (ctx.role === "BUSINESS_VIEWER" && String(doc.businessId) !== String(ctx.businessId || "")) {
            return res.status(403).json({ status: false, statusCode: 403, message: "No tienes acceso a esta liquidación", data: {} });
        }
        return res.status(200).json({ status: true, statusCode: 200, message: "Liquidación", data: { settlement: doc } });
    } catch (error) {
        console.error("Error leyendo liquidación:", error);
        return res.status(500).json({ status: false, statusCode: 500, message: "Error interno del servidor", data: {} });
    }
}

/**
 * PATCH /api/hubs/me/settlements/:id/paid  (HUB_OWNER / HUB_ADMIN)
 * Body: { reference? }. El dinero se movió POR FUERA (banco del hub); aquí solo
 * queda el registro. Idempotente-seguro: solo transiciona PENDING → PAID.
 */
export async function markMySettlementPaid(req: Request, res: Response): Promise<Response> {
    const ctx = req.hubContext!;
    try {
        const reference = typeof req.body?.reference === "string" ? req.body.reference.trim().slice(0, 200) : null;
        const now = new Date();
        const doc: any = await hubSettlementModel
            .findOneAndUpdate(
                { _id: String(req.params.id), hubId: ctx.hubId, status: "PENDING" },
                { $set: { status: "PAID", paidAt: now, paidReference: reference, updated_at: now } },
                { new: true }
            )
            .select("-lines")
            .lean();
        if (!doc) {
            return res.status(409).json({
                status: false,
                statusCode: 409,
                message: "La liquidación no existe o ya estaba pagada",
                data: {},
            });
        }
        return res.status(200).json({ status: true, statusCode: 200, message: "Liquidación marcada como pagada", data: { settlement: doc } });
    } catch (error) {
        console.error("Error marcando liquidación:", error);
        return res.status(500).json({ status: false, statusCode: 500, message: "Error interno del servidor", data: {} });
    }
}

/**
 * GET /api/hubs/me/portal/settlements  (BUSINESS_VIEWER)
 * El estado de cuenta que ve el negocio: SUS liquidaciones, sin las de nadie más.
 */
export async function getMyPortalSettlements(req: Request, res: Response): Promise<Response> {
    const ctx = req.hubContext!;
    try {
        if (!ctx.businessId) {
            return res.status(403).json({ status: false, statusCode: 403, message: "Acceso sin negocio asignado", data: {} });
        }
        const settlements = await hubSettlementModel
            .find({ hubId: ctx.hubId, businessId: String(ctx.businessId) })
            .select("-lines")
            .sort({ period: -1 })
            .limit(36)
            .lean();
        return res.status(200).json({ status: true, statusCode: 200, message: "Estado de cuenta", data: { settlements } });
    } catch (error) {
        console.error("Error en estado de cuenta:", error);
        return res.status(500).json({ status: false, statusCode: 500, message: "Error interno del servidor", data: {} });
    }
}
