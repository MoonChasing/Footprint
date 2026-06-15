import initSqlJs, { Database as SqlJsDatabase } from 'sql.js';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import { runMigrations } from './migrations';

const DB_DIR = path.join(os.homedir(), '.timetrack');
const DB_PATH = path.join(DB_DIR, 'data.db');

let dbInstance: SqlJsDatabase | null = null;
let dirty = false;
let flushTimer: ReturnType<typeof setTimeout> | null = null;

/** Flush interval in ms (30 seconds) */
const FLUSH_INTERVAL = 30_000;

/**
 * Initialize the sql.js database asynchronously.
 * Must be called once before getDatabase().
 */
export async function initDatabase(extensionPath: string): Promise<void> {
    if (dbInstance) {
        return;
    }

    // Locate the WASM binary bundled with the extension
    const wasmBinary = fs.readFileSync(
        path.join(extensionPath, 'dist', 'sql-wasm.wasm')
    );

    const SQL = await initSqlJs({ wasmBinary });

    // Ensure directory exists
    fs.mkdirSync(DB_DIR, { recursive: true });

    // Load existing database or create new one
    if (fs.existsSync(DB_PATH)) {
        const fileBuffer = fs.readFileSync(DB_PATH);
        dbInstance = new SQL.Database(fileBuffer);
    } else {
        dbInstance = new SQL.Database();
    }

    // Configure pragmas (WAL not available in sql.js, use compatible settings)
    dbInstance.run('PRAGMA foreign_keys = ON');

    // Run migrations
    runMigrations(dbInstance);

    // Initial save to ensure the file exists on disk
    flushToFile();
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
 * Flush the in-memory database to disk immediately.
 */
export function flushToFile(): void {
    if (!dbInstance) {
        return;
    }
    const data = dbInstance.export();
    const buffer = Buffer.from(data);
    fs.mkdirSync(DB_DIR, { recursive: true });
    // Write atomically: write to temp file then rename
    const tmpPath = DB_PATH + '.tmp';
    fs.writeFileSync(tmpPath, buffer);
    fs.renameSync(tmpPath, DB_PATH);
    dirty = false;
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
