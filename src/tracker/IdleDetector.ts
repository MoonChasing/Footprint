import { Disposable } from 'vscode';

export interface IdleDetectorCallbacks {
    onIdleStart: () => void;
    onIdleEnd: () => void;
}

/**
 * IdleDetector monitors user activity and fires callbacks
 * when the user becomes idle or returns from idle.
 *
 * All activity events call recordActivity() which is O(1).
 * A separate 10-second timer checks for idle timeout.
 */
export class IdleDetector implements Disposable {
    private lastActivityTime: number = Date.now();
    private _isIdle: boolean = false;
    private checkTimer: ReturnType<typeof setInterval> | null = null;
    private idleTimeoutMs: number;
    private readonly callbacks: IdleDetectorCallbacks;

    constructor(idleTimeoutMinutes: number, callbacks: IdleDetectorCallbacks) {
        this.idleTimeoutMs = idleTimeoutMinutes * 60 * 1000;
        this.callbacks = callbacks;
        // Check every 10 seconds
        this.checkTimer = setInterval(() => this.check(), 10_000);
    }

    /**
     * Call this on every user activity event.
     * Extremely lightweight — just a timestamp assignment.
     */
    recordActivity(): void {
        this.lastActivityTime = Date.now();
        if (this._isIdle) {
            this._isIdle = false;
            this.callbacks.onIdleEnd();
        }
    }

    get isIdle(): boolean {
        return this._isIdle;
    }

    /**
     * Timestamp of the user's most recent activity.
     * Use this — not Date.now() — when stamping session end_time, so that
     * idle/blur transitions don't inflate the session by up to idleTimeout.
     */
    get lastActivity(): number {
        return this.lastActivityTime;
    }

    /**
     * Update the idle timeout (e.g., when config changes).
     */
    updateTimeout(minutes: number): void {
        this.idleTimeoutMs = minutes * 60 * 1000;
    }

    private check(): void {
        if (!this._isIdle && (Date.now() - this.lastActivityTime) > this.idleTimeoutMs) {
            this._isIdle = true;
            this.callbacks.onIdleStart();
        }
    }

    dispose(): void {
        if (this.checkTimer) {
            clearInterval(this.checkTimer);
            this.checkTimer = null;
        }
    }
}
