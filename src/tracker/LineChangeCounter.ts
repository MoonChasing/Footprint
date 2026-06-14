import * as vscode from 'vscode';
import { PendingLineChange, EnvironmentContext } from '../types';
import { getDatabase } from '../database/Database';
import { insertLineChange } from '../database/queries';
import { getProjectContext } from '../env/EnvironmentInfo';

/**
 * Accumulates line change counts per file in memory,
 * flushing to the database periodically or on file switch.
 */
export class LineChangeCounter implements vscode.Disposable {
    private pending = new Map<string, PendingLineChange>();
    private lastFlushTime = Date.now();
    private disposables: vscode.Disposable[] = [];
    private envContext: EnvironmentContext;

    constructor(envContext: EnvironmentContext) {
        this.envContext = envContext;

        // Listen for text document changes
        this.disposables.push(
            vscode.workspace.onDidChangeTextDocument(event => {
                this.onDocumentChange(event);
            })
        );
    }

    /**
     * Process a text document change event.
     */
    private onDocumentChange(event: vscode.TextDocumentChangeEvent): void {
        // Skip non-file schemes (output panels, git diff, etc.)
        if (event.document.uri.scheme !== 'file') {
            return;
        }

        const filePath = event.document.uri.fsPath;
        let entry = this.pending.get(filePath);
        if (!entry) {
            entry = { added: 0, deleted: 0 };
            this.pending.set(filePath, entry);
        }

        for (const change of event.contentChanges) {
            // Lines deleted = lines spanned by the replaced range
            const linesDeleted = change.range.end.line - change.range.start.line;
            // Lines added = newlines in the inserted text
            const linesAdded = (change.text.match(/\n/g) || []).length;

            entry.added += linesAdded;
            entry.deleted += linesDeleted;
        }
    }

    /**
     * Flush pending changes for a specific file (e.g., on file switch).
     */
    flushFile(filePath: string | null): void {
        if (!filePath) return;
        const entry = this.pending.get(filePath);
        if (entry && (entry.added > 0 || entry.deleted > 0)) {
            this.writeToDb(filePath, entry);
            this.pending.delete(filePath);
        }
    }

    /**
     * Periodic flush — all files with pending changes.
     * Called from heartbeat tick. Only flushes if >= 60s since last flush.
     */
    maybeFlushAll(): void {
        const now = Date.now();
        if (now - this.lastFlushTime < 60_000) return;

        for (const [filePath, entry] of this.pending) {
            if (entry.added > 0 || entry.deleted > 0) {
                this.writeToDb(filePath, entry);
            }
        }
        this.pending.clear();
        this.lastFlushTime = now;
    }

    /**
     * Force flush all pending changes (e.g., on deactivation).
     */
    flushAll(): void {
        for (const [filePath, entry] of this.pending) {
            if (entry.added > 0 || entry.deleted > 0) {
                this.writeToDb(filePath, entry);
            }
        }
        this.pending.clear();
        this.lastFlushTime = Date.now();
    }

    private writeToDb(filePath: string, entry: PendingLineChange): void {
        try {
            const db = getDatabase();
            const fileUri = vscode.Uri.file(filePath);
            const project = getProjectContext(fileUri);

            insertLineChange(db, {
                timestamp: Date.now(),
                machineName: this.envContext.machineName,
                remoteType: this.envContext.remoteType,
                remoteHost: this.envContext.remoteHost,
                projectPath: project.projectPath,
                filePath,
                linesAdded: entry.added,
                linesDeleted: entry.deleted,
            });
        } catch (e) {
            // Don't crash the extension on DB write failure
            console.error('[TimeTrack] Failed to write line changes:', e);
        }
    }

    dispose(): void {
        this.flushAll();
        for (const d of this.disposables) {
            d.dispose();
        }
        this.disposables = [];
    }
}
