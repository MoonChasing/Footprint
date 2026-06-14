import Database from 'better-sqlite3';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import { runMigrations } from './migrations';

const DB_DIR = path.join(os.homedir(), '.timetrack');
const DB_PATH = path.join(DB_DIR, 'data.db');

let dbInstance: Database.Database | null = null;

/**
 * Get (or create) the shared SQLite database connection.
 * Uses WAL mode for concurrent multi-window access.
 */
export function getDatabase(): Database.Database {
    if (dbInstance) {
        return dbInstance;
    }

    // Ensure directory exists
    fs.mkdirSync(DB_DIR, { recursive: true });

    dbInstance = new Database(DB_PATH);

    // Configure for concurrent access
    dbInstance.pragma('journal_mode = WAL');
    dbInstance.pragma('busy_timeout = 5000');
    dbInstance.pragma('synchronous = NORMAL');
    dbInstance.pragma('foreign_keys = ON');

    // Run migrations
    runMigrations(dbInstance);

    return dbInstance;
}

/**
 * Close the database connection. Call on extension deactivation.
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
