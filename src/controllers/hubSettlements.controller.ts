import { Request, Response } from "express";
import hubModel from "../models/hubModel";
import hubSettlementModel from "../models/hubSettlementModel";
import { getHubSettlementLines, } from "../services/ordersService.external";
import { getBusinessesByHubId, assertBusinessBelongsToHub } from "../services/businessService.external";

/**
 * Mes calendario [inicio, fin] expresado en UTC para una zona horaria dada.
 * Los pedidos se guardan en UTC; el corte del mes debe ser el del HUB (que el
 * pedido de las 11pm del 31 caiga en el mes que el operador vive, no en UTC).
 */
function monthRangeInTz(period: string, tz: string): { start: Date; end: Date } {
    const [y, m] = period.split("-").map((n) => parseInt(n, 10));
    // Offset de la zona en ese momento (técnica estándar sin librerías de TZ)
    const offsetAt = (utcGuess: Date): number => {
        const local = new Date(utcGuess.toLocaleString("en-US", { timeZone: tz }));
        const utc = new Date(utcGuess.toLocaleString("en-US", { timeZone: "UTC" }));
        return utc.getTime() - local.getTime();
    };
    const startGuess = new Date(Date.UTC(y, m - 1, 1));
    const endGuess = new Date(Date.UTC(m === 12 ? y + 1 : y, m === 12 ? 0 : m, 1));
    const start = new Date(startGuess.getTime() + offsetAt(startGuess));
    const end = new Date(endGuess.getTime() + offsetAt(endGuess) - 1);
    return { start, end };
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
 * Body: { period: 'YYYY-MM', businessId? }.
 * Genera (o RE-genera, mientras no esté PAID) la liquidación del período para
 * un negocio o para todos los del hub. La cifra sale de re-contar orders
 * (entregados y pagados); la comisión, del override del negocio o del default.
 */
export async function generateMySettlements(req: Request, res: Response): Promise<Response> {
    const ctx = req.hubContext!;
    try {
        const period = String(req.body?.period || "").trim();
        if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) {
            return res.status(400).json({ status: false, statusCode: 400, message: "period debe ser YYYY-MM", data: {} });
        }
        const requestedBusinessId = req.body?.businessId ? String(req.body.businessId) : null;

        const hub: any = await hubModel
            .findById(ctx.hubId)
            .select("timezone currency settlementConfig commissionOverrides")
            .lean();
        if (!hub) {
            return res.status(404).json({ status: false, statusCode: 404, message: "Hub no encontrado", data: {} });
        }
        const { start, end } = monthRangeInTz(period, hub.timezone || "America/El_Salvador");

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
