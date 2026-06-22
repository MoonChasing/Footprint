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
