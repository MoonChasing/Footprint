import * as vscode from 'vscode';
import * as path from 'path';
import { randomUUID } from 'crypto';
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

    constructor(statusBar: StatusBarController) {
        this.windowId = randomUUID();
        this.envContext = getEnvironmentContext();
        this.statusBar = statusBar;

        const config = getConfig();

        // Initialize idle detector
        this.idleDetector = new IdleDetector(config.idleTimeout, {
            onIdleStart: () => this.onBecameIdle(),
            onIdleEnd: () => this.onBecameActive(),
        });

        // Initialize line change counter
        this.lineChangeCounter = new LineChangeCounter(this.envContext);

        // Clean up orphaned sessions from previous crashes
        this.recoverCrashedSessions();

        // Register event listeners
        this.registerListeners();

        // Start heartbeat
        this.heartbeatTimer = setInterval(
            () => this.tick(),
            config.heartbeatInterval * 1000
        );

        // Check if a window is already focused and has an active editor
        if (vscode.window.state.focused) {
            this.state = 'active';
            const editor = vscode.window.activeTextEditor;
            if (editor && this.shouldTrack(editor.document)) {
                this.openNewSession(editor.document);
            }
        }
    }

    /**
     * Manually pause tracking.
     */
    pause(): void {
        this.isPaused = true;
        this.closeCurrentSession();
        this.statusBar.setPaused(true);
    }

    /**
     * Resume tracking after manual pause.
     */
    resume(): void {
        this.isPaused = false;
        this.statusBar.setPaused(false);
        // Re-check current state
        if (vscode.window.state.focused && !this.idleDetector.isIdle) {
            this.state = 'active';
            const editor = vscode.window.activeTextEditor;
            if (editor && this.shouldTrack(editor.document)) {
                this.openNewSession(editor.document);
            }
        }
    }

    private registerListeners(): void {
        // File switch
        this.disposables.push(
            vscode.window.onDidChangeActiveTextEditor(editor => {
                this.idleDetector.recordActivity();
                this.onFileSwitch(editor);
            })
        );

        // Window focus/blur
        this.disposables.push(
            vscode.window.onDidChangeWindowState(state => {
                if (state.focused) {
                    this.onWindowFocus();
                } else {
                    this.onWindowBlur();
                }
            })
        );

        // Text document changes (idle reset + line counting)
        this.disposables.push(
            vscode.workspace.onDidChangeTextDocument(event => {
                const scheme = event.document.uri.scheme;
                if (scheme === 'file' || scheme === 'vscode-remote') {
                    this.idleDetector.recordActivity();
                }
            })
        );

        // Cursor movement (idle reset)
        this.disposables.push(
            vscode.window.onDidChangeTextEditorSelection(() => {
                this.idleDetector.recordActivity();
            })
        );

        // Scrolling (idle reset)
        this.disposables.push(
            vscode.window.onDidChangeTextEditorVisibleRanges(() => {
                this.idleDetector.recordActivity();
            })
        );

        // Configuration changes
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
                updateSessionEndTime(db, this.currentSessionId, Date.now());
            } catch (e) {
                console.error('[TimeTrack] Heartbeat update failed:', e);
            }

            // Periodic line change flush
            this.lineChangeCounter.maybeFlushAll();
        }

        // Update status bar
        this.statusBar.refresh();
    }

    private onFileSwitch(editor: vscode.TextEditor | undefined): void {
        if (this.isPaused) return;

        // Flush line changes for the old file
        this.lineChangeCounter.flushFile(this.currentFile);

        // Close current session
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

    private closeCurrentSession(): void {
        if (this.currentSessionId) {
            try {
                const db = getDatabase();
                closeSession(db, this.currentSessionId, Date.now());
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

    private shouldTrack(document: vscode.TextDocument): boolean {
        const config = getConfig();

        // Skip untitled files unless configured
        if (document.uri.scheme === 'untitled' && !config.trackUntitled) {
            return false;
        }

        // Track file:// (local) and vscode-remote:// (SSH, WSL, container) schemes
        const trackableSchemes = ['file', 'vscode-remote'];
        if (!trackableSchemes.includes(document.uri.scheme)) {
            return false;
        }

        // Check exclude patterns
        const filePath = document.uri.fsPath || document.uri.path;
        if (shouldExcludeFile(filePath, config.excludePatterns)) {
            return false;
        }

        return true;
    }

    private onConfigChange(): void {
        const config = getConfig();
        this.idleDetector.updateTimeout(config.idleTimeout);

        // Restart heartbeat with new interval
        if (this.heartbeatTimer) {
            clearInterval(this.heartbeatTimer);
        }
        this.heartbeatTimer = setInterval(
            () => this.tick(),
            config.heartbeatInterval * 1000
        );
    }

    dispose(): void {
        // Close current session
        this.closeCurrentSession();

        // Flush remaining line changes
        this.lineChangeCounter.flushAll();

        // Stop heartbeat
        if (this.heartbeatTimer) {
            clearInterval(this.heartbeatTimer);
            this.heartbeatTimer = null;
        }

        // Dispose sub-modules
        this.idleDetector.dispose();
        this.lineChangeCounter.dispose();

        // Dispose event listeners
        for (const d of this.disposables) {
            d.dispose();
        }
        this.disposables = [];
    }
}
