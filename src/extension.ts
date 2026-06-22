import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { ActivityTracker } from './tracker/ActivityTracker';
import { StatusBarController } from './ui/StatusBarController';
import { ReportPanel } from './ui/ReportPanel';
import { initDatabase, getDatabase, closeDatabase, getDatabasePath } from './database/Database';
import { getTodayTotalMs, exportAllData } from './database/queries';
import { getConfig } from './config';
import { formatDateUtc8 } from './utils/tz';

let tracker: ActivityTracker | undefined;
let statusBar: StatusBarController | undefined;
let reportPanel: ReportPanel | undefined;

export async function activate(context: vscode.ExtensionContext) {
    console.log('[TimeTrack] Extension activating...');

    const windowId = randomUUID();

    // Initialize database (creates ~/.timetrack/data.db if needed).
    // Synchronous now that we're on better-sqlite3 — no async init dance.
    try {
        initDatabase(context.extensionPath, windowId);
    } catch (e) {
        vscode.window.showErrorMessage(`TimeTrack: Failed to initialize database: ${e}`);
        return;
    }

    // Initialize UI
    const config = getConfig();

    statusBar = new StatusBarController();
    if (config.showStatusBar) {
        statusBar.show();
    }
    context.subscriptions.push(statusBar);

    reportPanel = new ReportPanel(context.extensionUri);
    context.subscriptions.push(reportPanel);

    // When VSCode restores a window with the Report tab open from a previous
    // session, this serializer hands us the persisted panel. We re-render its
    // HTML with the freshly installed UI assets instead of letting VSCode
    // resurrect whatever stale DOM it serialized last time.
    context.subscriptions.push(
        vscode.window.registerWebviewPanelSerializer(ReportPanel.viewType, {
            deserializeWebviewPanel: async (panel) => {
                reportPanel?.adopt(panel);
            },
        })
    );

    // Initialize tracker
    tracker = new ActivityTracker(statusBar, windowId);
    context.subscriptions.push(tracker);

    // Register commands
    context.subscriptions.push(
        vscode.commands.registerCommand('timetrack.showReport', () => {
            reportPanel?.show();
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('timetrack.pauseTracking', () => {
            tracker?.pause();
            vscode.window.showInformationMessage('TimeTrack: Tracking paused');
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('timetrack.resumeTracking', () => {
            tracker?.resume();
            vscode.window.showInformationMessage('TimeTrack: Tracking resumed');
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('timetrack.today', () => {
            try {
                const db = getDatabase();
                const todayMs = getTodayTotalMs(db);
                const hours = Math.floor(todayMs / 3600_000);
                const minutes = Math.floor((todayMs % 3600_000) / 60_000);
                vscode.window.showInformationMessage(
                    `TimeTrack Today: ${hours}h ${minutes}m`
                );
            } catch (e) {
                vscode.window.showErrorMessage(`TimeTrack: ${e}`);
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('timetrack.exportData', async () => {
            try {
                const db = getDatabase();
                const data = exportAllData(db);
                const jsonStr = JSON.stringify(data, null, 2);

                // Ask user where to save
                const uri = await vscode.window.showSaveDialog({
                    defaultUri: vscode.Uri.file(
                        path.join(
                            vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? require('os').homedir(),
                            `timetrack-export-${formatDateUtc8()}.json`
                        )
                    ),
                    filters: { 'JSON': ['json'] },
                });

                if (uri) {
                    fs.writeFileSync(uri.fsPath, jsonStr, 'utf-8');
                    vscode.window.showInformationMessage(
                        `TimeTrack: Data exported to ${uri.fsPath} (${data.sessions.length} sessions, ${data.lineChanges.length} line change records)`
                    );
                }
            } catch (e) {
                vscode.window.showErrorMessage(`TimeTrack: Export failed: ${e}`);
            }
        })
    );

    // Initial status bar refresh
    statusBar?.refresh();

    console.log(`[TimeTrack] Extension activated. DB: ${getDatabasePath()}`);
}

export function deactivate() {
    console.log('[TimeTrack] Extension deactivating...');

    // CRITICAL: dispose the tracker BEFORE closing the database, so that
    // the current session's closeSession() UPDATE lands while the DB is
    // still open. context.subscriptions disposal happens AFTER deactivate()
    // returns, which is too late — we must do it explicitly here.
    try {
        tracker?.dispose();
    } catch (e) {
        console.error('[TimeTrack] Tracker dispose failed:', e);
    }
    tracker = undefined;

    closeDatabase();

    console.log('[TimeTrack] Extension deactivated.');
}
