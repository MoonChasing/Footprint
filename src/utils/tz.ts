/**
 * UTC+8 (Asia/Shanghai) day-boundary helpers.
 *
 * All session/line_change timestamps are stored as UTC ms (Date.now()), but the
 * notion of "today" is fixed to UTC+8 — so that data is consistent whether the
 * extension host runs locally (Windows UTC+8) or on a remote SSH dev box that
 * may be in UTC+0 or another zone.
 */

/** Fixed offset: UTC+8 in milliseconds. */
export const TZ_OFFSET_MS = 8 * 3600_000;

/** One day in milliseconds. */
const DAY_MS = 86_400_000;

/**
 * Start of UTC+8 day for a given UTC ms instant (defaults to now).
 * Returns a UTC ms suitable for comparing with stored timestamps.
 */
export function startOfDayUtc8(ms: number = Date.now()): number {
    return Math.floor((ms + TZ_OFFSET_MS) / DAY_MS) * DAY_MS - TZ_OFFSET_MS;
}

/**
 * UTC ms range [start, end) covering the calendar day "YYYY-MM-DD" in UTC+8.
 * The dateStr is interpreted as a UTC+8 wall date.
 */
export function dayRangeUtc8(dateStr: string): { start: number; end: number } {
    // 'YYYY-MM-DD' + 'T00:00:00+08:00' yields the exact UTC ms for UTC+8 midnight.
    const start = Date.parse(dateStr + 'T00:00:00+08:00');
    return { start, end: start + DAY_MS };
}

/**
 * Format a UTC ms instant (defaults to now) as "YYYY-MM-DD" in UTC+8.
 */
export function formatDateUtc8(ms: number = Date.now()): string {
    const shifted = new Date(ms + TZ_OFFSET_MS);
    const y = shifted.getUTCFullYear();
    const m = String(shifted.getUTCMonth() + 1).padStart(2, '0');
    const d = String(shifted.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

/**
 * Shift a "YYYY-MM-DD" UTC+8 date string by `days` and return the resulting date string.
 */
export function shiftDateUtc8(dateStr: string, days: number): string {
    const { start } = dayRangeUtc8(dateStr);
    return formatDateUtc8(start + days * DAY_MS);
}

/**
 * Return the "YYYY-MM-DD" date that is `n` days before today in UTC+8.
 * n=0 → today, n=1 → yesterday, n=6 → the start of the "last 7 days" window.
 */
export function daysAgoUtc8(n: number, fromMs: number = Date.now()): string {
    return formatDateUtc8(startOfDayUtc8(fromMs) - n * DAY_MS);
}

/**
 * Range covering "this week" in UTC+8: Monday 00:00 through today 23:59.
 * Returns { startDate, endDate } as YYYY-MM-DD strings (inclusive on both ends —
 * callers feed them to dayRangeUtc8 which handles the half-open conversion).
 *
 * Week start = Monday (ISO 8601 convention). If today is Monday, start === end.
 */
export function weekRangeUtc8(fromMs: number = Date.now()): { startDate: string; endDate: string } {
    const startOfToday = startOfDayUtc8(fromMs);
    // JS getUTCDay: Sunday=0, Monday=1, ..., Saturday=6
    // We need offset back to Monday: if dow=1 (Mon) → 0; dow=0 (Sun) → 6; else dow-1
    const dow = new Date(startOfToday + TZ_OFFSET_MS).getUTCDay();
    const offsetToMonday = (dow + 6) % 7;
    const monday = startOfToday - offsetToMonday * DAY_MS;
    return {
        startDate: formatDateUtc8(monday),
        endDate: formatDateUtc8(startOfToday),
    };
}

/**
 * Range covering "this month" in UTC+8: day-1 of current month through today.
 */
export function monthRangeUtc8(fromMs: number = Date.now()): { startDate: string; endDate: string } {
    const today = formatDateUtc8(fromMs);
    // today = "YYYY-MM-DD" — replace day component with "01"
    const firstOfMonth = today.slice(0, 8) + '01';
    return { startDate: firstOfMonth, endDate: today };
}

/**
 * Count inclusive days between two YYYY-MM-DD strings (both ends are UTC+8 dates).
 * Used by callers to decide whether to bucket by day vs week in reports.
 */
export function daysBetweenUtc8(startDate: string, endDate: string): number {
    const a = dayRangeUtc8(startDate).start;
    const b = dayRangeUtc8(endDate).start;
    return Math.round((b - a) / DAY_MS) + 1;
}
