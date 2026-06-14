import Database from 'better-sqlite3';

const CURRENT_VERSION = 1;

/**
 * Run all pending database migrations.
 */
export function runMigrations(db: Database.Database): void {
    // Create schema_version table if it doesn't exist
    db.exec(`
        CREATE TABLE IF NOT EXISTS schema_version (
            version INTEGER NOT NULL
        )
    `);

    const row = db.prepare('SELECT version FROM schema_version LIMIT 1').get() as { version: number } | undefined;
    const currentVersion = row?.version ?? 0;

    if (currentVersion < 1) {
        migrateToV1(db);
    }

    // Update version
    if (currentVersion === 0) {
        db.prepare('INSERT INTO schema_version (version) VALUES (?)').run(CURRENT_VERSION);
    } else if (currentVersion < CURRENT_VERSION) {
        db.prepare('UPDATE schema_version SET version = ?').run(CURRENT_VERSION);
    }
}

function migrateToV1(db: Database.Database): void {
    db.exec(`
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
        );

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
        );

        CREATE INDEX IF NOT EXISTS idx_sessions_time ON sessions(start_time, end_time);
        CREATE INDEX IF NOT EXISTS idx_sessions_project ON sessions(project_path, start_time);
        CREATE INDEX IF NOT EXISTS idx_sessions_machine ON sessions(machine_name, remote_type);
        CREATE INDEX IF NOT EXISTS idx_sessions_active ON sessions(is_active) WHERE is_active = 1;
        CREATE INDEX IF NOT EXISTS idx_line_changes_time ON line_changes(timestamp);
        CREATE INDEX IF NOT EXISTS idx_line_changes_file ON line_changes(file_path, timestamp);
    `);
}
