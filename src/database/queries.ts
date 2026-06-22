import type { Database as Db } from 'better-sqlite3';
import { Session, LineChange, FileSummary, DayEntry, HourBlock, ProjectSummary, LanguageSummary } from '../types';
import { startOfDayUtc8, dayRangeUtc8, formatDateUtc8, shiftDateUtc8 } from '../utils/tz';

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
 * Get file breakdown for a specific date.
 */
export function getFileBreakdown(db: Db, date: string, limit: number): FileSummary[] {
    const { start, end } = dayRangeUtc8(date);
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
 * Get weekly overview (last 7 days).
 */
export function getWeeklyOverview(db: Db): DayEntry[] {
    const results: DayEntry[] = [];
    const todayStr = formatDateUtc8();
    const stmt = db.prepare(`
        SELECT COALESCE(SUM(end_time - start_time), 0) as total
        FROM sessions
        WHERE start_time >= ? AND start_time < ?
    `);
    for (let i = 6; i >= 0; i--) {
        const dateStr = shiftDateUtc8(todayStr, -i);
        const { start, end } = dayRangeUtc8(dateStr);
        const row = stmt.get(start, end) as { total: number } | undefined;
        results.push({ date: dateStr, totalMs: row?.total ?? 0 });
    }
    return results;
}

/**
 * Get hourly timeline for a specific date.
 */
export function getTimeline(db: Db, date: string): HourBlock[] {
    const { start } = dayRangeUtc8(date);
    const blocks: HourBlock[] = [];
    const stmt = db.prepare(`
        SELECT file_name as fileName,
               SUM(MIN(end_time, ?) - MAX(start_time, ?)) as durationMs
        FROM sessions
        WHERE start_time < ? AND end_time > ?
        GROUP BY file_name
        ORDER BY durationMs DESC
        LIMIT 5
    `);

    for (let hour = 0; hour < 24; hour++) {
        const hourStart = start + hour * 3600000;
        const hourEnd = hourStart + 3600000;
        const rows = stmt.all(hourEnd, hourStart, hourEnd, hourStart) as Array<{
            fileName: string; durationMs: number;
        }>;
        blocks.push({
            hour,
            files: rows.filter(r => r.durationMs > 0),
        });
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
 * Get language breakdown for a single date (UTC+8 day).
 * Groups sessions by language_id and counts both total time and distinct files.
 * Sessions with NULL language_id (e.g. unrecognized extensions) are bucketed
 * together under languageId=null.
 */
export function getLanguageBreakdown(db: Db, date: string): LanguageSummary[] {
    const { start, end } = dayRangeUtc8(date);
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
 * Get line changes for a specific date.
 */
export function getLineChanges(db: Db, date: string, limit: number): FileSummary[] {
    const { start, end } = dayRangeUtc8(date);
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
