// ════════════════════════════════════════════════════════════════════════════
// Períodos de liquidación (compartido por hub_settlements y hub_driver_settlements).
//
// Clave del período según la frecuencia de corte, SIEMPRE en la zona horaria
// del hub (que el pedido de las 11pm del último día caiga en el período que el
// operador vive, no en UTC):
//   daily     YYYY-MM-DD
//   weekly    YYYY-Www       (semana ISO: lunes a domingo)
//   biweekly  YYYY-MM-Q1|Q2  (1–15 y 16–fin de mes)
//   monthly   YYYY-MM
// ════════════════════════════════════════════════════════════════════════════

export type SettlementFrequency = "daily" | "weekly" | "biweekly" | "monthly";

export const SETTLEMENT_FREQUENCIES: SettlementFrequency[] = ["daily", "weekly", "biweekly", "monthly"];

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

/** Redondeo a 2 decimales (dinero). */
export function round2(n: number): number {
    return Math.round(n * 100) / 100;
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

/** Año y número de semana ISO de una fecha civil (la semana puede pertenecer al año anterior/siguiente). */
function isoWeekOf(year: number, monthIndex: number, day: number): { isoYear: number; week: number } {
    const dt = new Date(Date.UTC(year, monthIndex, day));
    const weekday = (dt.getUTCDay() + 6) % 7; // lunes = 0
    // El jueves de la semana define el año ISO al que pertenece.
    dt.setUTCDate(dt.getUTCDate() - weekday + 3);
    const isoYear = dt.getUTCFullYear();
    const firstThursday = new Date(Date.UTC(isoYear, 0, 4));
    const firstWeekday = (firstThursday.getUTCDay() + 6) % 7;
    firstThursday.setUTCDate(firstThursday.getUTCDate() - firstWeekday + 3);
    const week = 1 + Math.round((dt.getTime() - firstThursday.getTime()) / (7 * 86400000));
    return { isoYear, week };
}

/**
 * Rango [inicio, fin] en UTC de un período según su clave, con el corte en la zona
 * horaria del HUB. Semana = lunes a domingo; quincena = 1–15 y 16–fin.
 * Lanza Error("PERIOD_INVALID") si la clave no tiene un formato conocido.
 */
export function periodRangeInTz(period: string, tz: string): { start: Date; end: Date; frequency: SettlementFrequency } {
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

/** Fecha civil (año, mes 1–12, día) que vive el hub en ese instante. */
function civilDateInTz(date: Date, tz: string): { year: number; month: number; day: number } {
    // "MM/DD/YYYY" en en-US con partes numéricas de 2 dígitos.
    const text = date.toLocaleString("en-US", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" });
    const m = text.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (!m) {
        // Fallback (nunca debería pasar en Node >= 18 con ICU completo): UTC.
        return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() };
    }
    return { year: parseInt(m[3], 10), month: parseInt(m[1], 10), day: parseInt(m[2], 10) };
}

const pad2 = (n: number) => String(n).padStart(2, "0");

function periodKeyForCivilDate(frequency: SettlementFrequency, c: { year: number; month: number; day: number }): string {
    if (frequency === "daily") return `${c.year}-${pad2(c.month)}-${pad2(c.day)}`;
    if (frequency === "weekly") {
        const { isoYear, week } = isoWeekOf(c.year, c.month - 1, c.day);
        return `${isoYear}-W${pad2(week)}`;
    }
    if (frequency === "biweekly") return `${c.year}-${pad2(c.month)}-${c.day <= 15 ? "Q1" : "Q2"}`;
    return `${c.year}-${pad2(c.month)}`;
}

/**
 * Clave del período (según la frecuencia) que CONTIENE la fecha dada, en la
 * zona horaria del hub. Se verifica contra periodRangeInTz: si por un borde
 * de zona horaria la fecha cayera fuera del rango, se prueba con el día civil
 * anterior/siguiente y se devuelve el que sí la contiene.
 */
export function currentPeriodKey(frequency: SettlementFrequency, tz: string, date: Date = new Date()): string {
    const civil = civilDateInTz(date, tz);
    const key = periodKeyForCivilDate(frequency, civil);
    const contains = (k: string) => {
        try {
            const { start, end } = periodRangeInTz(k, tz);
            return date.getTime() >= start.getTime() && date.getTime() <= end.getTime();
        } catch {
            return false;
        }
    };
    if (contains(key)) return key;
    for (const delta of [-1, 1]) {
        const shifted = new Date(Date.UTC(civil.year, civil.month - 1, civil.day + delta));
        const alt = periodKeyForCivilDate(frequency, {
            year: shifted.getUTCFullYear(),
            month: shifted.getUTCMonth() + 1,
            day: shifted.getUTCDate(),
        });
        if (contains(alt)) return alt;
    }
    return key;
}
