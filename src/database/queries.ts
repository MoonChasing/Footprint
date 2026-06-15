import { Database as SqlJsDatabase } from 'sql.js';
import { Session, LineChange, FileSummary, DayEntry, HourBlock, ProjectSummary } from '../types';
import { markDirty } from './Database';

// --- Helper: sql.js query wrappers ---

/**
 * Run an INSERT/UPDATE/DELETE statement. Returns lastInsertRowid for INSERT.
 */
function run(db: SqlJsDatabase, sql: string, ...params: unknown[]): number {
    db.run(sql, params as any[]);
    // Get last insert rowid (useful for INSERT)
    const result = db.exec('SELECT last_insert_rowid() as id');
    return result.length > 0 ? (result[0].values[0][0] as number) : 0;
}

/**
 * Get a single row as an object. Returns undefined if no rows.
 */
function get<T>(db: SqlJsDatabase, sql: string, ...params: unknown[]): T | undefined {
    const stmt = db.prepare(sql);
    stmt.bind(params as any[]);
    if (stmt.step()) {
        const row = stmt.getAsObject() as T;
        stmt.free();
        return row;
    }
    stmt.free();
    return undefined;
}

/**
 * Get all rows as an array of objects.
 */
function all<T>(db: SqlJsDatabase, sql: string, ...params: unknown[]): T[] {
    const stmt = db.prepare(sql);
    stmt.bind(params as any[]);
    const rows: T[] = [];
    while (stmt.step()) {
        rows.push(stmt.getAsObject() as T);
    }
    stmt.free();
    return rows;
}

// --- Write Operations ---

/**
 * Insert a new session and return its ID.
 */
export function insertSession(db: SqlJsDatabase, session: Omit<Session, 'id'>): number {
    const id = run(db, `
        INSERT INTO sessions (start_time, end_time, machine_name, remote_type, remote_host,
            project_path, project_name, file_path, file_name, language_id, window_id, is_active)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
        session.startTime, session.endTime,
        session.machineName, session.remoteType, session.remoteHost,
        session.projectPath, session.projectName,
        session.filePath, session.fileName, session.languageId,
        session.windowId, session.isActive
    );
    markDirty();
    return id;
}

/**
 * Update a session's end_time (heartbeat update).
 */
export function updateSessionEndTime(db: SqlJsDatabase, sessionId: number, endTime: number): void {
    run(db, 'UPDATE sessions SET end_time = ? WHERE id = ?', endTime, sessionId);
    markDirty();
}

/**
 * Close a session (set is_active = 0 and update end_time).
 */
export function closeSession(db: SqlJsDatabase, sessionId: number, endTime: number): void {
    run(db, 'UPDATE sessions SET end_time = ?, is_active = 0 WHERE id = ?', endTime, sessionId);
    markDirty();
}

/**
 * Close all orphaned sessions from crashed windows.
 * Called on activation to clean up stale sessions.
 */
export function closeOrphanedSessions(db: SqlJsDatabase, currentWindowId: string): void {
    run(db, 'UPDATE sessions SET is_active = 0 WHERE is_active = 1 AND window_id != ?', currentWindowId);
    markDirty();
}

/**
 * Insert a line change record.
 */
export function insertLineChange(db: SqlJsDatabase, change: Omit<LineChange, 'id'>): void {
    run(db, `
        INSERT INTO line_changes (timestamp, machine_name, remote_type, remote_host, project_path, file_path, lines_added, lines_deleted)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `,
        change.timestamp, change.machineName, change.remoteType, change.remoteHost,
        change.projectPath, change.filePath, change.linesAdded, change.linesDeleted
    );
    markDirty();
}

// --- Read Operations ---

/**
 * Get today's total tracked time in milliseconds.
 */
export function getTodayTotalMs(db: SqlJsDatabase): number {
    const todayStart = getStartOfDayMs();
    const row = get<{ total: number }>(db, `
        SELECT COALESCE(SUM(end_time - start_time), 0) as total
        FROM sessions
        WHERE start_time >= ?
    `, todayStart);
    return row?.total ?? 0;
}

/**
 * Get today's total time for a specific file.
 */
export function getFileTodayMs(db: SqlJsDatabase, filePath: string): number {
    const todayStart = getStartOfDayMs();
    const row = get<{ total: number }>(db, `
        SELECT COALESCE(SUM(end_time - start_time), 0) as total
        FROM sessions
        WHERE file_path = ? AND start_time >= ?
    `, filePath, todayStart);
    return row?.total ?? 0;
}

/**
 * Get file breakdown for a specific date.
 */
export function getFileBreakdown(db: SqlJsDatabase, date: string, limit: number): FileSummary[] {
    const { start, end } = getDayRange(date);
    const rows = all<{ filePath: string; fileName: string; languageId: string | null; totalMs: number }>(db, `
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
    `, start, end, limit);

    // Attach line changes
    return rows.map(row => {
        const lc = get<{ linesAdded: number; linesDeleted: number }>(db, `
            SELECT
                COALESCE(SUM(lines_added), 0) as linesAdded,
                COALESCE(SUM(lines_deleted), 0) as linesDeleted
            FROM line_changes
            WHERE file_path = ? AND timestamp >= ? AND timestamp < ?
        `, row.filePath, start, end);
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
export function getWeeklyOverview(db: SqlJsDatabase): DayEntry[] {
    const results: DayEntry[] = [];
    for (let i = 6; i >= 0; i--) {
        const date = new Date();
        date.setDate(date.getDate() - i);
        const dateStr = formatDate(date);
        const { start, end } = getDayRange(dateStr);
        const row = get<{ total: number }>(db, `
            SELECT COALESCE(SUM(end_time - start_time), 0) as total
            FROM sessions
            WHERE start_time >= ? AND start_time < ?
        `, start, end);
        results.push({ date: dateStr, totalMs: row?.total ?? 0 });
    }
    return results;
}

/**
 * Get hourly timeline for a specific date.
 */
export function getTimeline(db: SqlJsDatabase, date: string): HourBlock[] {
    const { start } = getDayRange(date);
    const blocks: HourBlock[] = [];

    for (let hour = 0; hour < 24; hour++) {
        const hourStart = start + hour * 3600000;
        const hourEnd = hourStart + 3600000;
        const rows = all<{ fileName: string; durationMs: number }>(db, `
            SELECT file_name as fileName,
                   SUM(MIN(end_time, ?) - MAX(start_time, ?)) as durationMs
            FROM sessions
            WHERE start_time < ? AND end_time > ?
            GROUP BY file_name
            ORDER BY durationMs DESC
            LIMIT 5
        `, hourEnd, hourStart, hourEnd, hourStart);

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
export function getProjectBreakdown(db: SqlJsDatabase, startDate: string, endDate: string): ProjectSummary[] {
    const start = getDayRange(startDate).start;
    const end = getDayRange(endDate).end;
    const rows = all<ProjectSummary>(db, `
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
    `, start, end);
    return rows;
}

/**
 * Get line changes for a specific date.
 */
export function getLineChanges(db: SqlJsDatabase, date: string, limit: number): FileSummary[] {
    const { start, end } = getDayRange(date);
    const rows = all<{ filePath: string; fileName: string; linesAdded: number; linesDeleted: number }>(db, `
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
    `, start, end, limit);
    return rows.map(r => ({
        ...r,
        languageId: null,
        totalMs: 0,
    }));
}

/**
 * Export all data as JSON.
 */
export function exportAllData(db: SqlJsDatabase): { sessions: Session[]; lineChanges: LineChange[] } {
    const sessions = all<Session>(db, `
        SELECT id, start_time as startTime, end_time as endTime,
               machine_name as machineName, remote_type as remoteType, remote_host as remoteHost,
               project_path as projectPath, project_name as projectName,
               file_path as filePath, file_name as fileName, language_id as languageId,
               window_id as windowId, is_active as isActive
        FROM sessions ORDER BY start_time
    `);

    const lineChanges = all<LineChange>(db, `
        SELECT id, timestamp, machine_name as machineName, remote_type as remoteType,
               remote_host as remoteHost, project_path as projectPath, file_path as filePath,
               lines_added as linesAdded, lines_deleted as linesDeleted
        FROM line_changes ORDER BY timestamp
    `);

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
