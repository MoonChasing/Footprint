import * as vscode from 'vscode';
import { EnvironmentContext } from '../types';
import { getDatabase } from '../database/Database';
import { insertLineChange } from '../database/queries';

/**
 * Records line-change activity per-edit directly to the database.
 *
 * With better-sqlite3, every INSERT is durable on return, so we no longer
 * buffer in an in-memory Map. This eliminates the previous data-loss
 * window where edits sat in RAM for up to 60s before reaching SQLite.
 *
 * The `shouldRecord` predicate is injected by ActivityTracker so the
 * counter honors pause state, exclude patterns, and trackUntitled config.
 */
export class LineChangeCounter implements vscode.Disposable {
    private disposables: vscode.Disposable[] = [];
    private envContext: EnvironmentContext;
    private windowId: string;
    private shouldRecord: (document: vscode.TextDocument) => boolean;

    constructor(
        envContext: EnvironmentContext,
        windowId: string,
        shouldRecord: (document: vscode.TextDocument) => boolean,
    ) {
        this.envContext = envContext;
        this.windowId = windowId;
        this.shouldRecord = shouldRecord;

        this.disposables.push(
            vscode.workspace.onDidChangeTextDocument(event => {
                this.onDocumentChange(event);
            })
        );
    }

    private onDocumentChange(event: vscode.TextDocumentChangeEvent): void {
        const doc = event.document;
        const scheme = doc.uri.scheme;
        if (scheme !== 'file' && scheme !== 'vscode-remote') {
            return;
        }
        if (!this.shouldRecord(doc)) {
            return;
        }

        let added = 0;
        let deleted = 0;
        for (const change of event.contentChanges) {
            deleted += change.range.end.line - change.range.start.line;
            added += (change.text.match(/\n/g) || []).length;
        }
        if (added === 0 && deleted === 0) {
            return;
        }

        this.writeToDb(doc.uri.fsPath, added, deleted);
    }

    private writeToDb(filePath: string, added: number, deleted: number): void {
        try {
            const db = getDatabase();
            const project = this.getProjectForFile(filePath);
            insertLineChange(db, {
                timestamp: Date.now(),
                machineName: this.envContext.machineName,
                remoteType: this.envContext.remoteType,
                remoteHost: this.envContext.remoteHost,
                projectPath: project.projectPath,
                filePath,
                linesAdded: added,
                linesDeleted: deleted,
                windowId: this.windowId,
            });
        } catch (e) {
            console.error('[TimeTrack] Failed to write line change:', e);
        }
    }

    private getProjectForFile(filePath: string): { projectPath: string; projectName: string } {
        const folders = vscode.workspace.workspaceFolders;
        if (folders) {
            for (const folder of folders) {
                const folderPath = folder.uri.fsPath || folder.uri.path;
                if (filePath.startsWith(folderPath)) {
                    return { projectPath: folderPath, projectName: folder.name };
                }
            }
        }
        return {
            projectPath: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? 'unknown',
            projectName: vscode.workspace.name ?? 'Unknown',
        };
    }

    dispose(): void {
        for (const d of this.disposables) {
            d.dispose();
        }
        this.disposables = [];
    }
}
