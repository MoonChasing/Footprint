import * as vscode from 'vscode';
import * as path from 'path';
import { TrackerState, EnvironmentContext } from '../types';
import { getDatabase } from '../database/Database';
import { insertSession, updateSessionEndTime, closeSession, closeOrphanedSessions } from '../database/queries';
import { getEnvironmentContext, getProjectContext } from '../env/EnvironmentInfo';
import { getConfig, shouldExcludeFile } from '../config';
import { IdleDetector } from './IdleDetector';
import { LineChangeCounter } from './LineChangeCounter';
import { StatusBarController } from '../ui/StatusBarController';

/**
 * ActivityTracker is the core orchestrator.
 * It manages the tracking state machine (ACTIVE / IDLE / UNFOCUSED),
 * opens/closes sessions, and coordinates all other modules.
 */
export class ActivityTracker implements vscode.Disposable {
    private state: TrackerState = 'unfocused';
    private currentFile: string | null = null;
    private currentSessionId: number | null = null;
    private windowId: string;
    private envContext: EnvironmentContext;
    private idleDetector: IdleDetector;
    private lineChangeCounter: LineChangeCounter;
    private statusBar: StatusBarController;
    private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
    private disposables: vscode.Disposable[] = [];
    private isPaused: boolean = false;

    constructor(statusBar: StatusBarController, windowId: string) {
        this.windowId = windowId;
        this.envContext = getEnvironmentContext();
        this.statusBar = statusBar;

        const config = getConfig();

        this.idleDetector = new IdleDetector(config.idleTimeout, {
            onIdleStart: () => this.onBecameIdle(),
            onIdleEnd: () => this.onBecameActive(),
        });

        // Line counter only records when this tracker says recording is allowed.
        this.lineChangeCounter = new LineChangeCounter(
            this.envContext,
            this.windowId,
            doc => this.shouldRecordEdit(doc),
        );

        // Clean up orphaned sessions from previous crashes / other dead windows.
        this.recoverCrashedSessions();

        this.registerListeners();

        this.heartbeatTimer = setInterval(
            () => this.tick(),
            config.heartbeatInterval * 1000
        );

        if (vscode.window.state.focused) {
            this.state = 'active';
            const editor = vscode.window.activeTextEditor;
            if (editor && this.shouldTrack(editor.document)) {
                this.openNewSession(editor.document);
            }
        }
    }

    pause(): void {
        this.isPaused = true;
        this.closeCurrentSession();
        this.statusBar.setPaused(true);
    }

    resume(): void {
        this.isPaused = false;
        this.statusBar.setPaused(false);
        if (vscode.window.state.focused && !this.idleDetector.isIdle) {
            this.state = 'active';
            const editor = vscode.window.activeTextEditor;
            if (editor && this.shouldTrack(editor.document)) {
                this.openNewSession(editor.document);
            }
        }
    }

    private registerListeners(): void {
        this.disposables.push(
            vscode.window.onDidChangeActiveTextEditor(editor => {
                this.idleDetector.recordActivity();
                this.onFileSwitch(editor);
            })
        );

        this.disposables.push(
            vscode.window.onDidChangeWindowState(state => {
                if (state.focused) {
                    this.onWindowFocus();
                } else {
                    this.onWindowBlur();
                }
            })
        );

        this.disposables.push(
            vscode.workspace.onDidChangeTextDocument(event => {
                const scheme = event.document.uri.scheme;
                if (scheme === 'file' || scheme === 'vscode-remote') {
                    this.idleDetector.recordActivity();
                }
            })
        );

        this.disposables.push(
            vscode.window.onDidChangeTextEditorSelection(() => {
                this.idleDetector.recordActivity();
            })
        );

        this.disposables.push(
            vscode.window.onDidChangeTextEditorVisibleRanges(() => {
                this.idleDetector.recordActivity();
            })
        );

        this.disposables.push(
            vscode.workspace.onDidChangeConfiguration(event => {
                if (event.affectsConfiguration('timetrack')) {
                    this.onConfigChange();
                }
            })
        );
    }

    private tick(): void {
        if (this.isPaused) return;

        if (this.state === 'active' && this.currentSessionId) {
            try {
                const db = getDatabase();
                // Clamp end_time to last real activity to avoid inflating the
                // session past the user's actual editing time (e.g. they
                // stopped typing 90s ago but idle threshold is 2min).
                const clamped = Math.min(Date.now(), this.idleDetector.lastActivity);
                updateSessionEndTime(db, this.currentSessionId, clamped);
            } catch (e) {
                console.error('[TimeTrack] Heartbeat update failed:', e);
            }
        }

        this.statusBar.refresh();
    }

    private onFileSwitch(editor: vscode.TextEditor | undefined): void {
        if (this.isPaused) return;

        // Close current session FIRST (so its end_time is stamped before we change state).
        this.closeCurrentSession();

        if (editor && this.shouldTrack(editor.document)) {
            this.currentFile = editor.document.uri.fsPath;
            if (this.state === 'active') {
                this.openNewSession(editor.document);
            }
        } else {
            this.currentFile = null;
        }
    }

    private onWindowFocus(): void {
        if (this.isPaused) return;

        if (this.idleDetector.isIdle) {
            this.state = 'idle';
        } else {
            this.onBecameActive();
        }
    }

    private onWindowBlur(): void {
        if (this.isPaused) return;

        this.state = 'unfocused';
        this.closeCurrentSession();
    }

    private onBecameIdle(): void {
        if (this.isPaused) return;

        this.state = 'idle';
        this.closeCurrentSession();
    }

    private onBecameActive(): void {
        if (this.isPaused) return;

        this.state = 'active';
        if (this.currentFile && !this.currentSessionId) {
            const editor = vscode.window.activeTextEditor;
            if (editor && this.shouldTrack(editor.document)) {
                this.openNewSession(editor.document);
            }
        }
    }

    private openNewSession(document: vscode.TextDocument): void {
        try {
            const db = getDatabase();
            const project = getProjectContext(document.uri);
            const now = Date.now();

            this.currentFile = document.uri.fsPath;
            this.currentSessionId = insertSession(db, {
                startTime: now,
                endTime: now,
                machineName: this.envContext.machineName,
                remoteType: this.envContext.remoteType,
                remoteHost: this.envContext.remoteHost,
                projectPath: project.projectPath,
                projectName: project.projectName,
                filePath: document.uri.fsPath,
                fileName: path.basename(document.uri.fsPath),
                languageId: document.languageId || null,
                windowId: this.windowId,
                isActive: 1,
            });
        } catch (e) {
            console.error('[TimeTrack] Failed to open session:', e);
        }
    }

    /**
     * Close the current session. Stamps end_time at last-known activity
     * (not Date.now()) so that idle/blur don't inflate the duration.
     */
    private closeCurrentSession(): void {
        if (this.currentSessionId) {
            try {
                const db = getDatabase();
                const endTime = Math.min(Date.now(), this.idleDetector.lastActivity);
                closeSession(db, this.currentSessionId, endTime);
            } catch (e) {
                console.error('[TimeTrack] Failed to close session:', e);
            }
            this.currentSessionId = null;
        }
    }

    private recoverCrashedSessions(): void {
        try {
            const db = getDatabase();
            closeOrphanedSessions(db, this.windowId);
        } catch (e) {
            console.error('[TimeTrack] Failed to recover crashed sessions:', e);
        }
    }

    /**
     * Should this document be tracked for session time?
     */
    private shouldTrack(document: vscode.TextDocument): boolean {
        const config = getConfig();

        if (document.uri.scheme === 'untitled' && !config.trackUntitled) {
            return false;
        }

        const trackableSchemes = ['file', 'vscode-remote'];
        if (!trackableSchemes.includes(document.uri.scheme)) {
            return false;
        }

        const filePath = document.uri.fsPath || document.uri.path;
        if (shouldExcludeFile(filePath, config.excludePatterns)) {
            return false;
        }

        return true;
    }

    /**
     * Should this document's edits be recorded as line changes?
     * Same predicate as shouldTrack PLUS the tracker must not be paused.
     * Auto-formatters / LSP edits while the window is unfocused or idle
     * still count (the edits are real), but paused state suppresses them.
     */
    private shouldRecordEdit(document: vscode.TextDocument): boolean {
        if (this.isPaused) return false;
        return this.shouldTrack(document);
    }

    private onConfigChange(): void {
        const config = getConfig();
        this.idleDetector.updateTimeout(config.idleTimeout);

        if (this.heartbeatTimer) {
            clearInterval(this.heartbeatTimer);
        }
        this.heartbeatTimer = setInterval(
            () => this.tick(),
            config.heartbeatInterval * 1000
        );
    }

    dispose(): void {
        // Close current session first — its UPDATE lands durably before the
        // database is closed by the caller (see extension.ts deactivate()).
        this.closeCurrentSession();

        if (this.heartbeatTimer) {
            clearInterval(this.heartbeatTimer);
            this.heartbeatTimer = null;
        }

        this.idleDetector.dispose();
        this.lineChangeCounter.dispose();

        for (const d of this.disposables) {
            d.dispose();
        }
        this.disposables = [];
    }
}
