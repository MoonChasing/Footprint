import initSqlJs, { Database as SqlJsDatabase } from 'sql.js';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import { runMigrations } from './migrations';

const DB_DIR = path.join(os.homedir(), '.timetrack');
const DB_PATH = path.join(DB_DIR, 'data.db');

let SQL: any = null;
let dbInstance: SqlJsDatabase | null = null;
let dirty = false;
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let windowId = '';
let lastFlushedSessionId = 0;
let lastFlushedLineChangeId = 0;
let onReloadCallback: (() => void) | null = null;
let pendingOrphanCleanup = false;

/** Flush interval in ms (30 seconds) */
const FLUSH_INTERVAL = 30_000;

/**
 * Initialize the sql.js database asynchronously.
 * Must be called once before getDatabase().
 */
export async function initDatabase(extensionPath: string, wid: string): Promise<void> {
    if (dbInstance) {
        return;
    }

    windowId = wid;

    // Locate the WASM binary bundled with the extension
    const wasmBinary = fs.readFileSync(
        path.join(extensionPath, 'dist', 'sql-wasm.wasm')
    );

    SQL = await initSqlJs({ wasmBinary });

    // Ensure directory exists
    fs.mkdirSync(DB_DIR, { recursive: true });

    // Load existing database or create new one
    if (fs.existsSync(DB_PATH)) {
        const fileBuffer = fs.readFileSync(DB_PATH);
        dbInstance = new SQL.Database(fileBuffer);
    } else {
        dbInstance = new SQL.Database();
    }

    // Configure pragmas
    dbInstance.run('PRAGMA foreign_keys = ON');

    // Run migrations
    runMigrations(dbInstance);

    // Record watermarks
    updateWatermarks();

    // Initial save to ensure the file exists on disk
    flushToFile();
}

/**
 * Register a callback to be invoked after database reload.
 * Used by ActivityTracker to re-query its active session ID.
 */
export function setOnReloadCallback(cb: () => void): void {
    onReloadCallback = cb;
}

/**
 * Signal that orphaned sessions from other windows have been closed in memory.
 * The next flush will propagate this cleanup to the disk database.
 */
export function markOrphanCleanupPending(): void {
    pendingOrphanCleanup = true;
}

/**
 * Get the shared SQLite database connection.
 * Throws if initDatabase() has not been called.
 */
export function getDatabase(): SqlJsDatabase {
    if (!dbInstance) {
        throw new Error('Database not initialized. Call initDatabase() first.');
    }
    return dbInstance;
}

/**
 * Mark the database as dirty (data changed).
 * Schedules a flush to disk after FLUSH_INTERVAL.
 */
export function markDirty(): void {
    dirty = true;
    if (!flushTimer) {
        flushTimer = setTimeout(() => {
            flushToFile();
            flushTimer = null;
        }, FLUSH_INTERVAL);
    }
}

/**
 * Update watermarks to current max IDs in the in-memory database.
 */
function updateWatermarks(): void {
    if (!dbInstance) return;
    const sessResult = dbInstance.exec('SELECT COALESCE(MAX(id), 0) FROM sessions');
    lastFlushedSessionId = sessResult.length > 0 ? (sessResult[0].values[0][0] as number) : 0;

    const lcResult = dbInstance.exec('SELECT COALESCE(MAX(id), 0) FROM line_changes');
    lastFlushedLineChangeId = lcResult.length > 0 ? (lcResult[0].values[0][0] as number) : 0;
}

/**
 * Flush the in-memory database to disk using merge strategy.
 * Merges only this window's changes into the disk file to avoid overwriting other windows' data.
 */
export function flushToFile(): void {
    if (!dbInstance || !SQL) {
        return;
    }

    fs.mkdirSync(DB_DIR, { recursive: true });

    // If disk file doesn't exist, do a full export
    if (!fs.existsSync(DB_PATH)) {
        fullExport();
        updateWatermarks();
        dirty = false;
        return;
    }

    try {
        // Load the disk database
        const diskBuffer = fs.readFileSync(DB_PATH);
        const diskDb = new SQL.Database(diskBuffer);
        runMigrations(diskDb);

        // Merge sessions: update existing ones that belong to this window
        mergeSessionsUpdate(diskDb);
        // Merge sessions: insert new ones from this window
        mergeSessionsInsert(diskDb);

        // If orphan cleanup was performed since last flush, propagate to disk
        if (pendingOrphanCleanup) {
            diskDb.run('UPDATE sessions SET is_active = 0 WHERE is_active = 1 AND window_id != ?', [windowId]);
            pendingOrphanCleanup = false;
        }

        // Merge line_changes: insert new ones from this window
        mergeLineChangesInsert(diskDb);

        // Write merged disk DB to file
        const mergedData = diskDb.export();
        const buffer = Buffer.from(mergedData);
        const tmpPath = DB_PATH + '.tmp';
        fs.writeFileSync(tmpPath, buffer);
        fs.renameSync(tmpPath, DB_PATH);
        diskDb.close();

        // Reload: replace in-memory DB with the merged version
        reloadFromDisk();

        dirty = false;
    } catch (e) {
        console.error('[TimeTrack] Merge flush failed, falling back to full export:', e);
        fullExport();
        updateWatermarks();
        dirty = false;
    }
}

/**
 * Merge sessions: UPDATE existing sessions in diskDb that belong to this window.
 * These are sessions that existed at last flush but may have updated end_time/is_active.
 */
function mergeSessionsUpdate(diskDb: SqlJsDatabase): void {
    if (!dbInstance) return;

    const stmt = dbInstance.prepare(
        'SELECT id, end_time, is_active FROM sessions WHERE window_id = ? AND id <= ?'
    );
    stmt.bind([windowId, lastFlushedSessionId]);

    while (stmt.step()) {
        const row = stmt.getAsObject() as { id: number; end_time: number; is_active: number };
        diskDb.run(
            'UPDATE sessions SET end_time = ?, is_active = ? WHERE id = ?',
            [row.end_time, row.is_active, row.id]
        );
    }
    stmt.free();
}

/**
 * Merge sessions: INSERT new sessions from this window that were created after last flush.
 */
function mergeSessionsInsert(diskDb: SqlJsDatabase): void {
    if (!dbInstance) return;

    const stmt = dbInstance.prepare(
        'SELECT start_time, end_time, machine_name, remote_type, remote_host, project_path, project_name, file_path, file_name, language_id, window_id, is_active FROM sessions WHERE window_id = ? AND id > ?'
    );
    stmt.bind([windowId, lastFlushedSessionId]);

    while (stmt.step()) {
        const row = stmt.getAsObject() as Record<string, unknown>;
        diskDb.run(
            `INSERT INTO sessions (start_time, end_time, machine_name, remote_type, remote_host, project_path, project_name, file_path, file_name, language_id, window_id, is_active)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [row.start_time, row.end_time, row.machine_name, row.remote_type, row.remote_host,
             row.project_path, row.project_name, row.file_path, row.file_name, row.language_id,
             row.window_id, row.is_active]
        );
    }
    stmt.free();
}

/**
 * Merge line_changes: INSERT new line changes from this window since last flush.
 */
function mergeLineChangesInsert(diskDb: SqlJsDatabase): void {
    if (!dbInstance) return;

    const stmt = dbInstance.prepare(
        'SELECT timestamp, machine_name, remote_type, remote_host, project_path, file_path, lines_added, lines_deleted, window_id FROM line_changes WHERE window_id = ? AND id > ?'
    );
    stmt.bind([windowId, lastFlushedLineChangeId]);

    while (stmt.step()) {
        const row = stmt.getAsObject() as Record<string, unknown>;
        diskDb.run(
            `INSERT INTO line_changes (timestamp, machine_name, remote_type, remote_host, project_path, file_path, lines_added, lines_deleted, window_id)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [row.timestamp, row.machine_name, row.remote_type, row.remote_host,
             row.project_path, row.file_path, row.lines_added, row.lines_deleted, row.window_id]
        );
    }
    stmt.free();
}

/**
 * Reload the in-memory database from the disk file.
 */
function reloadFromDisk(): void {
    if (!SQL) return;

    const oldDb = dbInstance;
    const fileBuffer = fs.readFileSync(DB_PATH);
    dbInstance = new SQL.Database(fileBuffer);
    dbInstance.run('PRAGMA foreign_keys = ON');
    runMigrations(dbInstance);
    updateWatermarks();

    if (oldDb) {
        oldDb.close();
    }

    if (onReloadCallback) {
        onReloadCallback();
    }
}

/**
 * Full export of in-memory database (used when no disk file exists).
 */
function fullExport(): void {
    if (!dbInstance) return;
    const data = dbInstance.export();
    const buffer = Buffer.from(data);
    const tmpPath = DB_PATH + '.tmp';
    fs.writeFileSync(tmpPath, buffer);
    fs.renameSync(tmpPath, DB_PATH);
}

/**
 * Close the database connection and flush to disk.
 * Call on extension deactivation.
 */
export function closeDatabase(): void {
    if (flushTimer) {
        clearTimeout(flushTimer);
        flushTimer = null;
    }
    if (dbInstance) {
        // Final flush
        if (dirty) {
            flushToFile();
        }
        dbInstance.close();
        dbInstance = null;
    }
}

/**
 * Get the database file path (for export/debug purposes).
 */
export function getDatabasePath(): string {
    return DB_PATH;
}
