import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { ActivityTracker } from './tracker/ActivityTracker';
import { StatusBarController } from './ui/StatusBarController';
import { ReportPanel } from './ui/ReportPanel';
import { initDatabase, getDatabase, closeDatabase, getDatabasePath } from './database/Database';
import { getTodayTotalMs, exportAllData } from './database/queries';
import { getConfig } from './config';

let tracker: ActivityTracker | undefined;
let statusBar: StatusBarController | undefined;
let reportPanel: ReportPanel | undefined;

export async function activate(context: vscode.ExtensionContext) {
    console.log('[TimeTrack] Extension activating...');

    // Initialize database (creates ~/.timetrack/data.db if needed)
    try {
        await initDatabase(context.extensionPath);
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

    // Initialize tracker
    tracker = new ActivityTracker(statusBar);
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
                            `timetrack-export-${formatDate(new Date())}.json`
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

    // Tracker disposal handles closing sessions and flushing line changes
    // (done via context.subscriptions)

    // Close database connection and flush to disk
    closeDatabase();

    console.log('[TimeTrack] Extension deactivated.');
}

function formatDate(date: Date): string {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}
