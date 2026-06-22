/**
 * Shared type definitions for TimeTrack extension
 */

/** Remote environment types supported by VSCode */
export type RemoteType = 'local' | 'ssh-remote' | 'wsl' | 'dev-container' | 'codespaces';

/** Environment context for each tracking record */
export interface EnvironmentContext {
    machineName: string;
    remoteType: RemoteType;
    remoteHost: string | null;
}

/** Project context derived from the active workspace */
export interface ProjectContext {
    projectPath: string;
    projectName: string;
}

/** A time tracking session (one continuous period in a single file) */
export interface Session {
    id?: number;
    startTime: number;        // Unix ms
    endTime: number;          // Unix ms
    machineName: string;
    remoteType: RemoteType;
    remoteHost: string | null;
    projectPath: string;
    projectName: string;
    filePath: string;
    fileName: string;
    languageId: string | null;
    windowId: string;
    isActive: number;         // 1 = open, 0 = closed
}

/** A line change record (flushed periodically) */
export interface LineChange {
    id?: number;
    timestamp: number;        // Unix ms
    machineName: string;
    remoteType: RemoteType;
    remoteHost: string | null;
    projectPath: string;
    filePath: string;
    linesAdded: number;
    linesDeleted: number;
    windowId?: string;
}

/** Accumulated line changes in memory before flush */
export interface PendingLineChange {
    added: number;
    deleted: number;
}

/** Tracker state machine states */
export type TrackerState = 'active' | 'idle' | 'unfocused';

/** Configuration options */
export interface TimeTrackConfig {
    idleTimeout: number;         // minutes
    heartbeatInterval: number;   // seconds
    excludePatterns: string[];
    showStatusBar: boolean;
    trackUntitled: boolean;
}

/** Data for webview communication */
export interface DailySummary {
    totalMs: number;
    files: FileSummary[];
}

export interface FileSummary {
    filePath: string;
    fileName: string;
    languageId: string | null;
    totalMs: number;
    linesAdded: number;
    linesDeleted: number;
}

export interface DayEntry {
    date: string;              // YYYY-MM-DD
    totalMs: number;
}

export interface HourBlock {
    hour: number;              // 0-23
    files: Array<{
        fileName: string;
        durationMs: number;
    }>;
}

export interface ProjectSummary {
    projectName: string;
    projectPath: string;
    totalMs: number;
    machineName: string;
    remoteType: RemoteType;
}

/** Webview message protocol */
export type WebviewRequest =
    | { type: 'getDailySummary'; date: string }
    | { type: 'getWeeklyOverview' }
    | { type: 'getFileBreakdown'; date: string; limit: number }
    | { type: 'getProjectBreakdown'; startDate: string; endDate: string }
    | { type: 'getLineChanges'; date: string; limit: number }
    | { type: 'getTimeline'; date: string };

export type WebviewResponse =
    | { type: 'dailySummary'; data: DailySummary }
    | { type: 'weeklyOverview'; data: DayEntry[] }
    | { type: 'fileBreakdown'; data: FileSummary[] }
    | { type: 'projectBreakdown'; data: ProjectSummary[] }
    | { type: 'lineChanges'; data: FileSummary[] }
    | { type: 'timeline'; data: HourBlock[] };
