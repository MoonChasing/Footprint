import * as vscode from 'vscode';
import * as fs from 'fs';
import { Disposable } from 'vscode';
import { WebviewRequest, WebviewResponse } from '../types';
import { getDatabase } from '../database/Database';
import * as queries from '../database/queries';

/**
 * Manages the Webview panel for displaying detailed time tracking reports.
 */
export class ReportPanel implements Disposable {
    /**
     * viewType passed to createWebviewPanel and used by VSCode to associate
     * persisted webviews with our serializer on next window restore.
     */
    static readonly viewType = 'timetrackReport';

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

        const panel = vscode.window.createWebviewPanel(
            ReportPanel.viewType,
            'TimeTrack Report',
            vscode.ViewColumn.One,
            this.buildOptions(),
        );
        this.adopt(panel);
    }

    /**
     * Adopt a webview panel that VSCode handed back to us after a window
     * restore (via WebviewPanelSerializer.deserializeWebviewPanel). The HTML
     * is replaced unconditionally so the panel always renders the freshly
     * installed UI — never a stale snapshot baked into VSCode's state.
     */
    adopt(panel: vscode.WebviewPanel): void {
        // If we already have a panel (e.g. user invoked the command before
        // the serializer fired), close the incoming one to avoid duplicates.
        if (this.panel) {
            panel.dispose();
            this.panel.reveal(vscode.ViewColumn.One);
            return;
        }

        this.panel = panel;
        // VSCode preserves options across reloads, but explicitly reset
        // localResourceRoots to be safe (esp. if extensionUri changed).
        // The 'options' setter only exists on input options, not on the
        // panel itself, so we rely on createWebviewPanel's initial config.

        this.panel.webview.html = this.getHtmlContent(this.panel.webview);

        this.panel.webview.onDidReceiveMessage(
            (message: WebviewRequest) => this.handleMessage(message),
            undefined,
            this.disposables
        );

        this.panel.onDidDispose(() => {
            this.panel = undefined;
        }, null, this.disposables);
    }

    /**
     * Webview options shared between fresh-create and revive paths.
     */
    buildOptions(): vscode.WebviewPanelOptions & vscode.WebviewOptions {
        return {
            enableScripts: true,
            retainContextWhenHidden: true,
            localResourceRoots: [
                vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview'),
            ],
        };
    }

    private handleMessage(message: WebviewRequest): void {
        try {
            const db = getDatabase();
            let response: WebviewResponse;

            switch (message.type) {
                case 'getDailySummary': {
                    const files = queries.getFileBreakdown(db, message.startDate, message.endDate, 100);
                    const totalMs = files.reduce((sum, f) => sum + f.totalMs, 0);
                    response = { type: 'dailySummary', data: { totalMs, files } };
                    break;
                }
                case 'getDailyOverview': {
                    const { entries, bucket } = queries.getDailyOverview(db, message.startDate, message.endDate);
                    response = { type: 'dailyOverview', data: entries, bucket };
                    break;
                }
                case 'getFileBreakdown': {
                    const data = queries.getFileBreakdown(db, message.startDate, message.endDate, message.limit);
                    response = { type: 'fileBreakdown', data };
                    break;
                }
                case 'getProjectBreakdown': {
                    const data = queries.getProjectBreakdown(db, message.startDate, message.endDate);
                    response = { type: 'projectBreakdown', data };
                    break;
                }
                case 'getLineChanges': {
                    const data = queries.getLineChanges(db, message.startDate, message.endDate, message.limit);
                    response = { type: 'lineChanges', data };
                    break;
                }
                case 'getTimeline': {
                    const data = queries.getTimeline(db, message.startDate, message.endDate);
                    response = { type: 'timeline', data };
                    break;
                }
                case 'getLanguageBreakdown': {
                    const data = queries.getLanguageBreakdown(db, message.startDate, message.endDate);
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
        // Load the HTML body from the bundled index.html so changes to UI
        // structure (range picker, chart titles, new sections) take effect
        // without having to mirror the markup here.
        const htmlPath = vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview', 'index.html').fsPath;
        const rawHtml = fs.readFileSync(htmlPath, 'utf-8');

        // Extract the <body>…</body> contents — the wrapper <head> needs CSP
        // and nonce-stamped script tags, which we build below.
        const bodyMatch = rawHtml.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
        const bodyContent = bodyMatch ? bodyMatch[1] : rawHtml;

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
${bodyContent}
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
