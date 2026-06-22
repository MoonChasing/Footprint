import { Database as SqlJsDatabase } from 'sql.js';

const CURRENT_VERSION = 2;

/**
 * Run all pending database migrations.
 */
export function runMigrations(db: SqlJsDatabase): void {
    // Create schema_version table if it doesn't exist
    db.run(`
        CREATE TABLE IF NOT EXISTS schema_version (
            version INTEGER NOT NULL
        )
    `);

    const result = db.exec('SELECT version FROM schema_version LIMIT 1');
    const currentVersion = result.length > 0 ? (result[0].values[0][0] as number) : 0;

    if (currentVersion < 1) {
        migrateToV1(db);
    }
    if (currentVersion < 2) {
        migrateToV2(db);
    }

    // Update version
    if (currentVersion === 0) {
        db.run('INSERT INTO schema_version (version) VALUES (?)', [CURRENT_VERSION]);
    } else if (currentVersion < CURRENT_VERSION) {
        db.run('UPDATE schema_version SET version = ?', [CURRENT_VERSION]);
    }
}

function migrateToV1(db: SqlJsDatabase): void {
    db.run(`
        CREATE TABLE IF NOT EXISTS sessions (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            start_time    INTEGER NOT NULL,
            end_time      INTEGER NOT NULL,
            machine_name  TEXT NOT NULL,
            remote_type   TEXT NOT NULL,
            remote_host   TEXT,
            project_path  TEXT NOT NULL,
            project_name  TEXT NOT NULL,
            file_path     TEXT NOT NULL,
            file_name     TEXT NOT NULL,
            language_id   TEXT,
            window_id     TEXT NOT NULL,
            is_active     INTEGER NOT NULL DEFAULT 1
        )
    `);

    db.run(`
        CREATE TABLE IF NOT EXISTS line_changes (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp     INTEGER NOT NULL,
            machine_name  TEXT NOT NULL,
            remote_type   TEXT NOT NULL,
            remote_host   TEXT,
            project_path  TEXT NOT NULL,
            file_path     TEXT NOT NULL,
            lines_added   INTEGER NOT NULL DEFAULT 0,
            lines_deleted INTEGER NOT NULL DEFAULT 0
        )
    `);

    db.run('CREATE INDEX IF NOT EXISTS idx_sessions_time ON sessions(start_time, end_time)');
    db.run('CREATE INDEX IF NOT EXISTS idx_sessions_project ON sessions(project_path, start_time)');
    db.run('CREATE INDEX IF NOT EXISTS idx_sessions_machine ON sessions(machine_name, remote_type)');
    db.run('CREATE INDEX IF NOT EXISTS idx_sessions_active ON sessions(is_active) WHERE is_active = 1');
    db.run('CREATE INDEX IF NOT EXISTS idx_line_changes_time ON line_changes(timestamp)');
    db.run('CREATE INDEX IF NOT EXISTS idx_line_changes_file ON line_changes(file_path, timestamp)');
}

function migrateToV2(db: SqlJsDatabase): void {
    db.run("ALTER TABLE line_changes ADD COLUMN window_id TEXT NOT NULL DEFAULT ''");
}
