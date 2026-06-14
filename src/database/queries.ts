import Database from 'better-sqlite3';
import { Session, LineChange, FileSummary, DayEntry, HourBlock, ProjectSummary } from '../types';

/**
 * Insert a new session and return its ID.
 */
export function insertSession(db: Database.Database, session: Omit<Session, 'id'>): number {
    const stmt = db.prepare(`
        INSERT INTO sessions (start_time, end_time, machine_name, remote_type, remote_host,
            project_path, project_name, file_path, file_name, language_id, window_id, is_active)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const result = stmt.run(
        session.startTime, session.endTime,
        session.machineName, session.remoteType, session.remoteHost,
        session.projectPath, session.projectName,
        session.filePath, session.fileName, session.languageId,
        session.windowId, session.isActive
    );
    return Number(result.lastInsertRowid);
}

/**
 * Update a session's end_time (heartbeat update).
 */
export function updateSessionEndTime(db: Database.Database, sessionId: number, endTime: number): void {
    db.prepare('UPDATE sessions SET end_time = ? WHERE id = ?').run(endTime, sessionId);
}

/**
 * Close a session (set is_active = 0 and update end_time).
 */
export function closeSession(db: Database.Database, sessionId: number, endTime: number): void {
    db.prepare('UPDATE sessions SET end_time = ?, is_active = 0 WHERE id = ?').run(endTime, sessionId);
}

/**
 * Close all orphaned sessions from crashed windows.
 * Called on activation to clean up stale sessions.
 */
export function closeOrphanedSessions(db: Database.Database, currentWindowId: string): void {
    db.prepare('UPDATE sessions SET is_active = 0 WHERE is_active = 1 AND window_id != ?').run(currentWindowId);
}

/**
 * Insert a line change record.
 */
export function insertLineChange(db: Database.Database, change: Omit<LineChange, 'id'>): void {
    const stmt = db.prepare(`
        INSERT INTO line_changes (timestamp, machine_name, remote_type, remote_host, project_path, file_path, lines_added, lines_deleted)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
        change.timestamp, change.machineName, change.remoteType, change.remoteHost,
        change.projectPath, change.filePath, change.linesAdded, change.linesDeleted
    );
}

/**
 * Get today's total tracked time in milliseconds.
 */
export function getTodayTotalMs(db: Database.Database): number {
    const todayStart = getStartOfDayMs();
    const row = db.prepare(`
        SELECT COALESCE(SUM(end_time - start_time), 0) as total
        FROM sessions
        WHERE start_time >= ?
    `).get(todayStart) as { total: number };
    return row.total;
}

/**
 * Get today's total time for a specific file.
 */
export function getFileTodayMs(db: Database.Database, filePath: string): number {
    const todayStart = getStartOfDayMs();
    const row = db.prepare(`
        SELECT COALESCE(SUM(end_time - start_time), 0) as total
        FROM sessions
        WHERE file_path = ? AND start_time >= ?
    `).get(filePath, todayStart) as { total: number };
    return row.total;
}

/**
 * Get file breakdown for a specific date.
 */
export function getFileBreakdown(db: Database.Database, date: string, limit: number): FileSummary[] {
    const { start, end } = getDayRange(date);
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
    `).all(start, end, limit) as Array<{ filePath: string; fileName: string; languageId: string | null; totalMs: number }>;

    // Attach line changes
    return rows.map(row => {
        const lc = db.prepare(`
            SELECT
                COALESCE(SUM(lines_added), 0) as linesAdded,
                COALESCE(SUM(lines_deleted), 0) as linesDeleted
            FROM line_changes
            WHERE file_path = ? AND timestamp >= ? AND timestamp < ?
        `).get(row.filePath, start, end) as { linesAdded: number; linesDeleted: number };
        return {
            ...row,
            linesAdded: lc.linesAdded,
            linesDeleted: lc.linesDeleted,
        };
    });
}

/**
 * Get weekly overview (last 7 days).
 */
export function getWeeklyOverview(db: Database.Database): DayEntry[] {
    const results: DayEntry[] = [];
    for (let i = 6; i >= 0; i--) {
        const date = new Date();
        date.setDate(date.getDate() - i);
        const dateStr = formatDate(date);
        const { start, end } = getDayRange(dateStr);
        const row = db.prepare(`
            SELECT COALESCE(SUM(end_time - start_time), 0) as total
            FROM sessions
            WHERE start_time >= ? AND start_time < ?
        `).get(start, end) as { total: number };
        results.push({ date: dateStr, totalMs: row.total });
    }
    return results;
}

/**
 * Get hourly timeline for a specific date.
 */
export function getTimeline(db: Database.Database, date: string): HourBlock[] {
    const { start } = getDayRange(date);
    const blocks: HourBlock[] = [];

    for (let hour = 0; hour < 24; hour++) {
        const hourStart = start + hour * 3600000;
        const hourEnd = hourStart + 3600000;
        const rows = db.prepare(`
            SELECT file_name as fileName,
                   SUM(MIN(end_time, ?) - MAX(start_time, ?)) as durationMs
            FROM sessions
            WHERE start_time < ? AND end_time > ?
            GROUP BY file_name
            ORDER BY durationMs DESC
            LIMIT 5
        `).all(hourEnd, hourStart, hourEnd, hourStart) as Array<{ fileName: string; durationMs: number }>;

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
export function getProjectBreakdown(db: Database.Database, startDate: string, endDate: string): ProjectSummary[] {
    const start = getDayRange(startDate).start;
    const end = getDayRange(endDate).end;
    const rows = db.prepare(`
        SELECT
            project_name as projectName,
            project_path as projectPath,
            machine_name as machineName,
            remote_type as remoteType,
            COALESCE(SUM(end_time - start_time), 0) as totalMs
        FROM sessions
        WHERE start_time >= ? AND start_time < ?
        GROUP BY project_path, machine_name, remote_type
        ORDER BY totalMs DESC
    `).all(start, end) as ProjectSummary[];
    return rows;
}

/**
 * Get line changes for a specific date.
 */
export function getLineChanges(db: Database.Database, date: string, limit: number): FileSummary[] {
    const { start, end } = getDayRange(date);
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
    `).all(start, end, limit) as Array<{ filePath: string; fileName: string; linesAdded: number; linesDeleted: number }>;
    return rows.map(r => ({
        ...r,
        languageId: null,
        totalMs: 0,
    }));
}

/**
 * Export all data as JSON.
 */
export function exportAllData(db: Database.Database): { sessions: Session[]; lineChanges: LineChange[] } {
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
               lines_added as linesAdded, lines_deleted as linesDeleted
        FROM line_changes ORDER BY timestamp
    `).all() as LineChange[];

    return { sessions, lineChanges };
}

// --- Helpers ---

function getStartOfDayMs(): number {
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    return now.getTime();
}

function getDayRange(dateStr: string): { start: number; end: number } {
    const date = new Date(dateStr + 'T00:00:00');
    const start = date.getTime();
    const end = start + 86400000; // +24h
    return { start, end };
}

function formatDate(date: Date): string {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}
