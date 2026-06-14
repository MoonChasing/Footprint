import * as vscode from 'vscode';
import * as path from 'path';
import { Disposable } from 'vscode';
import { getDatabase } from '../database/Database';
import { getTodayTotalMs, getFileTodayMs } from '../database/queries';

/**
 * Manages the status bar item that shows today's total tracked time.
 */
export class StatusBarController implements Disposable {
    private item: vscode.StatusBarItem;
    private paused: boolean = false;

    constructor() {
        this.item = vscode.window.createStatusBarItem(
            vscode.StatusBarAlignment.Left,
            100
        );
        this.item.command = 'timetrack.showReport';
        this.item.tooltip = 'TimeTrack — click for detailed report';
        this.item.text = '$(clock) 0m';
    }

    /**
     * Show the status bar item.
     */
    show(): void {
        this.item.show();
    }

    /**
     * Hide the status bar item.
     */
    hide(): void {
        this.item.hide();
    }

    /**
     * Refresh the status bar with the latest data from DB.
     * Called every heartbeat interval (30s).
     */
    refresh(): void {
        if (this.paused) return;

        try {
            const db = getDatabase();
            const todayMs = getTodayTotalMs(db);
            this.item.text = `$(clock) ${this.formatDuration(todayMs)}`;

            // Update tooltip with current file info
            const editor = vscode.window.activeTextEditor;
            if (editor && editor.document.uri.scheme === 'file') {
                const filePath = editor.document.uri.fsPath;
                const fileMs = getFileTodayMs(db, filePath);
                this.item.tooltip = `${path.basename(filePath)}: ${this.formatDuration(fileMs)} today\nTotal today: ${this.formatDuration(todayMs)}\nClick for detailed report`;
            } else {
                this.item.tooltip = `Total today: ${this.formatDuration(todayMs)}\nClick for detailed report`;
            }
        } catch (e) {
            // Don't crash on DB read failure
            console.error('[TimeTrack] Status bar refresh failed:', e);
        }
    }

    /**
     * Set paused state — shows a paused indicator.
     */
    setPaused(paused: boolean): void {
        this.paused = paused;
        if (paused) {
            this.item.text = '$(clock) paused';
            this.item.tooltip = 'TimeTrack is paused. Click to view report.';
        } else {
            this.refresh();
        }
    }

    private formatDuration(ms: number): string {
        const totalMin = Math.floor(ms / 60_000);
        const hours = Math.floor(totalMin / 60);
        const minutes = totalMin % 60;
        if (hours === 0) return `${minutes}m`;
        return `${hours}h ${minutes}m`;
    }

    dispose(): void {
        this.item.dispose();
    }
}
