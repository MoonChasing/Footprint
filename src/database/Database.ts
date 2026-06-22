import Database from 'better-sqlite3';
import type { Database as Db } from 'better-sqlite3';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import { runMigrations } from './migrations';

const DB_DIR = path.join(os.homedir(), '.timetrack');
const DB_PATH = path.join(DB_DIR, 'data.db');

let dbInstance: Db | null = null;
let windowId = '';

/**
 * Initialize the SQLite database synchronously.
 * Must be called once before getDatabase().
 *
 * Writes are durable on return — no in-memory buffering, no flush timer.
 * WAL mode lets multiple VSCode windows read+write the same file safely.
 */
export function initDatabase(_extensionPath: string, wid: string): void {
    if (dbInstance) {
        return;
    }

    windowId = wid;

    // Ensure directory exists
    fs.mkdirSync(DB_DIR, { recursive: true });

    dbInstance = new Database(DB_PATH);

    // WAL mode: concurrent reader + single writer across processes,
    // with crash-safe atomic commits. The default journal_mode is DELETE
    // which serializes everything and is slower under multi-window load.
    dbInstance.pragma('journal_mode = WAL');
    // NORMAL gives durability at COMMIT-boundary for everything we care about,
    // at much higher throughput than FULL. WAL+NORMAL is the standard combo.
    dbInstance.pragma('synchronous = NORMAL');
    dbInstance.pragma('foreign_keys = ON');
    // Help readers see uncommitted progress quickly on busy systems.
    dbInstance.pragma('busy_timeout = 5000');

    runMigrations(dbInstance);
}

/**
 * Get the active database handle.
 * Throws if initDatabase() has not been called.
 */
export function getDatabase(): Db {
    if (!dbInstance) {
        throw new Error('Database not initialized. Call initDatabase() first.');
    }
    return dbInstance;
}

/**
 * Get this extension instance's window ID.
 */
export function getWindowId(): string {
    return windowId;
}

/**
 * Close the database connection.
 * Call on extension deactivation AFTER the tracker has been disposed.
 */
export function closeDatabase(): void {
    if (dbInstance) {
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
