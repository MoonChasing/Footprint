import * as vscode from 'vscode';
import * as path from 'path';
import { Disposable } from 'vscode';
import { WebviewRequest, WebviewResponse } from '../types';
import { getDatabase } from '../database/Database';
import * as queries from '../database/queries';

/**
 * Manages the Webview panel for displaying detailed time tracking reports.
 */
export class ReportPanel implements Disposable {
    private panel: vscode.WebviewPanel | undefined;
    private extensionUri: vscode.Uri;
    private disposables: Disposable[] = [];

    constructor(extensionUri: vscode.Uri) {
        this.extensionUri = extensionUri;
    }

    /**
     * Show (or focus) the report panel.
     */
    show(): void {
        if (this.panel) {
            this.panel.reveal(vscode.ViewColumn.One);
            return;
        }

        this.panel = vscode.window.createWebviewPanel(
            'timetrackReport',
            'TimeTrack Report',
            vscode.ViewColumn.One,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [
                    vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview'),
                ],
            }
        );

        this.panel.webview.html = this.getHtmlContent(this.panel.webview);

        // Handle messages from the webview
        this.panel.webview.onDidReceiveMessage(
            (message: WebviewRequest) => this.handleMessage(message),
            undefined,
            this.disposables
        );

        // Cleanup on close
        this.panel.onDidDispose(() => {
            this.panel = undefined;
        }, null, this.disposables);
    }

    private handleMessage(message: WebviewRequest): void {
        try {
            const db = getDatabase();
            let response: WebviewResponse;

            switch (message.type) {
                case 'getDailySummary': {
                    const files = queries.getFileBreakdown(db, message.date, 100);
                    const totalMs = files.reduce((sum, f) => sum + f.totalMs, 0);
                    response = { type: 'dailySummary', data: { totalMs, files } };
                    break;
                }
                case 'getWeeklyOverview': {
                    const data = queries.getWeeklyOverview(db);
                    response = { type: 'weeklyOverview', data };
                    break;
                }
                case 'getFileBreakdown': {
                    const data = queries.getFileBreakdown(db, message.date, message.limit);
                    response = { type: 'fileBreakdown', data };
                    break;
                }
                case 'getProjectBreakdown': {
                    const data = queries.getProjectBreakdown(db, message.startDate, message.endDate);
                    response = { type: 'projectBreakdown', data };
                    break;
                }
                case 'getLineChanges': {
                    const data = queries.getLineChanges(db, message.date, message.limit);
                    response = { type: 'lineChanges', data };
                    break;
                }
                case 'getTimeline': {
                    const data = queries.getTimeline(db, message.date);
                    response = { type: 'timeline', data };
                    break;
                }
                case 'getLanguageBreakdown': {
                    const data = queries.getLanguageBreakdown(db, message.date);
                    response = { type: 'languageBreakdown', data };
                    break;
                }
                default:
                    return;
            }

            this.panel?.webview.postMessage(response);
        } catch (e) {
            console.error('[TimeTrack] Error handling webview message:', e);
        }
    }

    private getHtmlContent(webview: vscode.Webview): string {
        const scriptUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview', 'main.js')
        );
        const styleUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview', 'styles.css')
        );
        const nonce = getNonce();

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy"
        content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
    <link href="${styleUri}" rel="stylesheet">
    <title>TimeTrack Report</title>
</head>
<body>
    <div id="app">
        <header>
            <h1>TimeTrack Report</h1>
            <div class="controls">
                <input type="date" id="datePicker" />
            </div>
        </header>
        <section class="summary-cards">
            <div class="card">
                <span class="card-label">Total Time</span>
                <span class="card-value" id="totalTime">--</span>
            </div>
            <div class="card">
                <span class="card-label">Files</span>
                <span class="card-value" id="fileCount">--</span>
            </div>
            <div class="card">
                <span class="card-label">Lines Changed</span>
                <span class="card-value" id="linesChanged">--</span>
            </div>
        </section>
        <section class="charts">
            <div class="chart-container">
                <h2>This Week</h2>
                <canvas id="weeklyChart"></canvas>
            </div>
            <div class="chart-container">
                <h2>Top Files Today</h2>
                <canvas id="filesChart"></canvas>
            </div>
            <div class="chart-container">
                <h2>Hourly Timeline</h2>
                <canvas id="timelineChart"></canvas>
            </div>
            <div class="chart-container">
                <h2>Line Changes</h2>
                <canvas id="lineChangesChart"></canvas>
            </div>
            <div class="chart-container">
                <h2>Projects</h2>
                <canvas id="projectsChart"></canvas>
            </div>
        </section>
    </div>
    <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
    }

    dispose(): void {
        if (this.panel) {
            this.panel.dispose();
        }
        for (const d of this.disposables) {
            d.dispose();
        }
        this.disposables = [];
    }
}

function getNonce(): string {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
}
