import type { Database as Db } from 'better-sqlite3';
import { Session, LineChange, FileSummary, DayEntry, HourBlock, ProjectSummary, LanguageSummary } from '../types';
import { startOfDayUtc8, dayRangeUtc8, shiftDateUtc8, daysBetweenUtc8, TZ_OFFSET_MS } from '../utils/tz';

// --- Write Operations ---

/**
 * Insert a new session and return its ID.
 */
export function insertSession(db: Db, session: Omit<Session, 'id'>): number {
    const info = db.prepare(`
        INSERT INTO sessions (start_time, end_time, machine_name, remote_type, remote_host,
            project_path, project_name, file_path, file_name, language_id, window_id, is_active)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
        session.startTime, session.endTime,
        session.machineName, session.remoteType, session.remoteHost,
        session.projectPath, session.projectName,
        session.filePath, session.fileName, session.languageId,
        session.windowId, session.isActive
    );
    return Number(info.lastInsertRowid);
}

/**
 * Update a session's end_time (heartbeat update).
 */
export function updateSessionEndTime(db: Db, sessionId: number, endTime: number): void {
    db.prepare('UPDATE sessions SET end_time = ? WHERE id = ?').run(endTime, sessionId);
}

/**
 * Close a session (set is_active = 0 and update end_time).
 */
export function closeSession(db: Db, sessionId: number, endTime: number): void {
    db.prepare('UPDATE sessions SET end_time = ?, is_active = 0 WHERE id = ?').run(endTime, sessionId);
}

/**
 * Close all orphaned sessions from crashed windows.
 * Called on activation to clean up stale sessions from this OR other dead windows.
 *
 * We can be aggressive: any is_active=1 session belonging to a different window_id
 * was either crashed or improperly closed. Mark it inactive; its end_time stays at
 * whatever the last heartbeat persisted (which is durable now that we're on
 * better-sqlite3 with WAL).
 */
export function closeOrphanedSessions(db: Db, currentWindowId: string): void {
    db.prepare(
        'UPDATE sessions SET is_active = 0 WHERE is_active = 1 AND window_id != ?'
    ).run(currentWindowId);
}

/**
 * Insert a line change record.
 */
export function insertLineChange(db: Db, change: Omit<LineChange, 'id'>): void {
    db.prepare(`
        INSERT INTO line_changes (timestamp, machine_name, remote_type, remote_host, project_path, file_path, lines_added, lines_deleted, window_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
        change.timestamp, change.machineName, change.remoteType, change.remoteHost,
        change.projectPath, change.filePath, change.linesAdded, change.linesDeleted,
        change.windowId ?? ''
    );
}

// --- Read Operations ---

/**
 * Find the active session ID for a given window.
 * Kept for API compatibility — no longer load-bearing now that IDs are stable.
 */
export function findActiveSessionId(db: Db, windowId: string): number | null {
    const row = db.prepare(
        'SELECT id FROM sessions WHERE window_id = ? AND is_active = 1 ORDER BY end_time DESC LIMIT 1'
    ).get(windowId) as { id: number } | undefined;
    return row?.id ?? null;
}

/**
 * Get today's total tracked time in milliseconds.
 */
export function getTodayTotalMs(db: Db): number {
    const todayStart = startOfDayUtc8();
    const row = db.prepare(`
        SELECT COALESCE(SUM(end_time - start_time), 0) as total
        FROM sessions
        WHERE start_time >= ?
    `).get(todayStart) as { total: number } | undefined;
    return row?.total ?? 0;
}

/**
 * Get today's total time for a specific file.
 */
export function getFileTodayMs(db: Db, filePath: string): number {
    const todayStart = startOfDayUtc8();
    const row = db.prepare(`
        SELECT COALESCE(SUM(end_time - start_time), 0) as total
        FROM sessions
        WHERE file_path = ? AND start_time >= ?
    `).get(filePath, todayStart) as { total: number } | undefined;
    return row?.total ?? 0;
}

/**
 * Get file breakdown for a date range (inclusive on both ends).
 */
export function getFileBreakdown(db: Db, startDate: string, endDate: string, limit: number): FileSummary[] {
    const start = dayRangeUtc8(startDate).start;
    const end = dayRangeUtc8(endDate).end;
    const rows = db.prepare(`
        SELECT
            s.file_path as filePath,
            s.file_name as fileName,
            s.language_id as languageId,
            COALESCE(SUM(s.end_time - s.start_time), 0) as totalMs
        FROM sessions s
        WHERE s.start_time >= ? AND s.start_time < ?
        GROUP BY s.file_path
        ORDER BY totalMs DESC
        LIMIT ?
    `).all(start, end, limit) as Array<{
        filePath: string; fileName: string; languageId: string | null; totalMs: number;
    }>;

    const lcStmt = db.prepare(`
        SELECT
            COALESCE(SUM(lines_added), 0) as linesAdded,
            COALESCE(SUM(lines_deleted), 0) as linesDeleted
        FROM line_changes
        WHERE file_path = ? AND timestamp >= ? AND timestamp < ?
    `);

    return rows.map(row => {
        const lc = lcStmt.get(row.filePath, start, end) as
            | { linesAdded: number; linesDeleted: number }
            | undefined;
        return {
            ...row,
            linesAdded: lc?.linesAdded ?? 0,
            linesDeleted: lc?.linesDeleted ?? 0,
        };
    });
}

/**
 * Get overview of a date range, bucketed by day or ISO week depending on span.
 *
 * - Range span ≤ DAILY_THRESHOLD days: one bucket per UTC+8 day; date = "YYYY-MM-DD"
 * - Range span > DAILY_THRESHOLD: one bucket per ISO week; date = Monday's "YYYY-MM-DD"
 *
 * Zero-activity days/weeks are filled in with totalMs=0 so the chart shows gaps.
 */
const DAILY_THRESHOLD_DAYS = 60;

export function getDailyOverview(
    db: Db,
    startDate: string,
    endDate: string,
): { entries: DayEntry[]; bucket: 'day' | 'week' } {
    const spanDays = daysBetweenUtc8(startDate, endDate);
    if (spanDays <= DAILY_THRESHOLD_DAYS) {
        return { entries: getDailyBuckets(db, startDate, endDate, spanDays), bucket: 'day' };
    }
    return { entries: getWeeklyBuckets(db, startDate, endDate), bucket: 'week' };
}

function getDailyBuckets(db: Db, startDate: string, endDate: string, spanDays: number): DayEntry[] {
    const results: DayEntry[] = [];
    const stmt = db.prepare(`
        SELECT COALESCE(SUM(end_time - start_time), 0) as total
        FROM sessions
        WHERE start_time >= ? AND start_time < ?
    `);
    for (let i = 0; i < spanDays; i++) {
        const dateStr = shiftDateUtc8(startDate, i);
        const { start, end } = dayRangeUtc8(dateStr);
        const row = stmt.get(start, end) as { total: number } | undefined;
        results.push({ date: dateStr, totalMs: row?.total ?? 0 });
    }
    return results;
}

function getWeeklyBuckets(db: Db, startDate: string, endDate: string): DayEntry[] {
    // Anchor each bucket on the ISO Monday of the week that contains startDate.
    // Iterate week-by-week until we pass endDate.
    const results: DayEntry[] = [];
    const stmt = db.prepare(`
        SELECT COALESCE(SUM(end_time - start_time), 0) as total
        FROM sessions
        WHERE start_time >= ? AND start_time < ?
    `);

    let cursor = mondayOfWeek(startDate);
    const endOfRange = dayRangeUtc8(endDate).end;

    while (true) {
        const weekStart = dayRangeUtc8(cursor).start;
        const weekEnd = weekStart + 7 * 86_400_000;
        if (weekStart >= endOfRange) break;
        // Clamp the last bucket so it doesn't extend past the user's selection.
        const effectiveEnd = Math.min(weekEnd, endOfRange);
        const row = stmt.get(weekStart, effectiveEnd) as { total: number } | undefined;
        results.push({ date: cursor, totalMs: row?.total ?? 0 });
        cursor = shiftDateUtc8(cursor, 7);
    }
    return results;
}

function mondayOfWeek(dateStr: string): string {
    const { start } = dayRangeUtc8(dateStr);
    // start is UTC ms of UTC+8 midnight; add TZ_OFFSET_MS and read getUTCDay
    const dow = new Date(start + TZ_OFFSET_MS).getUTCDay();
    const offset = (dow + 6) % 7; // dow=1(Mon)→0, dow=0(Sun)→6
    return shiftDateUtc8(dateStr, -offset);
}

/**
 * Get hour-of-day timeline for a date range.
 *
 * Buckets every session into one of 24 hour-of-day slots (UTC+8). For each
 * hour we keep the top-5 files by accumulated minutes across the entire range.
 *
 * The hour bucket uses session.start_time only — sessions that span a clock-hour
 * boundary count toward the hour they began, which is good enough for UI and
 * dramatically simpler than splitting durations across multiple hours.
 */
export function getTimeline(db: Db, startDate: string, endDate: string): HourBlock[] {
    const start = dayRangeUtc8(startDate).start;
    const end = dayRangeUtc8(endDate).end;

    // SQLite supports window functions since 3.25. Compute hour-of-day, sum
    // durations per (hour, file), then rank within each hour and keep top 5.
    const rows = db.prepare(`
        WITH per_file AS (
            SELECT
                CAST(((start_time + ?) / 3600000) % 24 AS INTEGER) AS hour,
                file_name AS fileName,
                SUM(end_time - start_time) AS durationMs
            FROM sessions
            WHERE start_time >= ? AND start_time < ?
            GROUP BY hour, file_name
        ),
        ranked AS (
            SELECT hour, fileName, durationMs,
                ROW_NUMBER() OVER (PARTITION BY hour ORDER BY durationMs DESC) AS rk
            FROM per_file
        )
        SELECT hour, fileName, durationMs
        FROM ranked
        WHERE rk <= 5 AND durationMs > 0
        ORDER BY hour, durationMs DESC
    `).all(TZ_OFFSET_MS, start, end) as Array<{
        hour: number; fileName: string; durationMs: number;
    }>;

    const blocks: HourBlock[] = [];
    for (let h = 0; h < 24; h++) {
        const files = rows
            .filter(r => r.hour === h)
            .map(r => ({ fileName: r.fileName, durationMs: r.durationMs }));
        blocks.push({ hour: h, files });
    }
    return blocks;
}

/**
 * Get project breakdown for a date range.
 */
export function getProjectBreakdown(db: Db, startDate: string, endDate: string): ProjectSummary[] {
    const start = dayRangeUtc8(startDate).start;
    const end = dayRangeUtc8(endDate).end;
    const rows = db.prepare(`
        SELECT
            project_name as projectName,
            project_path as projectPath,
            machine_name as machineName,
            remote_type as remoteType,
            remote_host as remoteHost,
            COALESCE(SUM(end_time - start_time), 0) as totalMs
        FROM sessions
        WHERE start_time >= ? AND start_time < ?
        GROUP BY project_path, machine_name, remote_type, remote_host
        ORDER BY totalMs DESC
    `).all(start, end) as ProjectSummary[];
    return rows;
}

/**
 * Get language breakdown for a date range (UTC+8).
 * Groups sessions by language_id and counts both total time and distinct files.
 * Sessions with NULL language_id (e.g. unrecognized extensions) are bucketed
 * together under languageId=null.
 */
export function getLanguageBreakdown(db: Db, startDate: string, endDate: string): LanguageSummary[] {
    const start = dayRangeUtc8(startDate).start;
    const end = dayRangeUtc8(endDate).end;
    const rows = db.prepare(`
        SELECT
            language_id as languageId,
            COALESCE(SUM(end_time - start_time), 0) as totalMs,
            COUNT(DISTINCT file_path) as fileCount
        FROM sessions
        WHERE start_time >= ? AND start_time < ?
        GROUP BY language_id
        ORDER BY totalMs DESC
    `).all(start, end) as LanguageSummary[];
    return rows;
}

/**
 * Get line changes for a date range.
 */
export function getLineChanges(db: Db, startDate: string, endDate: string, limit: number): FileSummary[] {
    const start = dayRangeUtc8(startDate).start;
    const end = dayRangeUtc8(endDate).end;
    const rows = db.prepare(`
        SELECT
            file_path as filePath,
            REPLACE(file_path, RTRIM(file_path, REPLACE(file_path, '/', '')), '') as fileName,
            COALESCE(SUM(lines_added), 0) as linesAdded,
            COALESCE(SUM(lines_deleted), 0) as linesDeleted
        FROM line_changes
        WHERE timestamp >= ? AND timestamp < ?
        GROUP BY file_path
        ORDER BY (linesAdded + linesDeleted) DESC
        LIMIT ?
    `).all(start, end, limit) as Array<{
        filePath: string; fileName: string; linesAdded: number; linesDeleted: number;
    }>;
    return rows.map(r => ({
        ...r,
        languageId: null,
        totalMs: 0,
    }));
}

/**
 * Export all data as JSON.
 */
export function exportAllData(db: Db): { sessions: Session[]; lineChanges: LineChange[] } {
    const sessions = db.prepare(`
        SELECT id, start_time as startTime, end_time as endTime,
               machine_name as machineName, remote_type as remoteType, remote_host as remoteHost,
               project_path as projectPath, project_name as projectName,
               file_path as filePath, file_name as fileName, language_id as languageId,
               window_id as windowId, is_active as isActive
        FROM sessions ORDER BY start_time
    `).all() as Session[];

    const lineChanges = db.prepare(`
        SELECT id, timestamp, machine_name as machineName, remote_type as remoteType,
               remote_host as remoteHost, project_path as projectPath, file_path as filePath,
               lines_added as linesAdded, lines_deleted as linesDeleted,
               window_id as windowId
        FROM line_changes ORDER BY timestamp
    `).all() as LineChange[];

    return { sessions, lineChanges };
}

// --- Helpers ---
// Date/timezone helpers live in ../utils/tz (pinned to UTC+8).
