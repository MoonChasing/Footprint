import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock vscode module
vi.mock('vscode', () => ({}));

import { IdleDetector } from '../../src/tracker/IdleDetector';

describe('IdleDetector', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('fires onIdleStart after timeout with no activity', () => {
        const onIdleStart = vi.fn();
        const onIdleEnd = vi.fn();
        const detector = new IdleDetector(2, { onIdleStart, onIdleEnd }); // 2 minutes

        // Advance past the idle timeout (2 min) + check interval (10s)
        vi.advanceTimersByTime(130_000); // 2min 10s
        expect(onIdleStart).toHaveBeenCalledOnce();
        expect(onIdleEnd).not.toHaveBeenCalled();

        detector.dispose();
    });

    it('does not fire if activity resets the timer', () => {
        const onIdleStart = vi.fn();
        const onIdleEnd = vi.fn();
        const detector = new IdleDetector(2, { onIdleStart, onIdleEnd });

        // Advance 100 seconds
        vi.advanceTimersByTime(100_000);
        // Record activity — resets the timer
        detector.recordActivity();

        // Advance another 100 seconds (total 200s from start, but only 100s since activity)
        vi.advanceTimersByTime(100_000);
        expect(onIdleStart).not.toHaveBeenCalled();

        detector.dispose();
    });

    it('fires onIdleEnd when activity resumes after idle', () => {
        const onIdleStart = vi.fn();
        const onIdleEnd = vi.fn();
        const detector = new IdleDetector(2, { onIdleStart, onIdleEnd });

        // Become idle
        vi.advanceTimersByTime(130_000);
        expect(onIdleStart).toHaveBeenCalledOnce();
        expect(detector.isIdle).toBe(true);

        // Resume activity
        detector.recordActivity();
        expect(onIdleEnd).toHaveBeenCalledOnce();
        expect(detector.isIdle).toBe(false);

        detector.dispose();
    });

    it('updateTimeout changes the idle threshold', () => {
        const onIdleStart = vi.fn();
        const onIdleEnd = vi.fn();
        const detector = new IdleDetector(2, { onIdleStart, onIdleEnd });

        // Update to 1 minute
        detector.updateTimeout(1);

        // Advance 70 seconds (past new 1 minute threshold)
        vi.advanceTimersByTime(70_000);
        expect(onIdleStart).toHaveBeenCalledOnce();

        detector.dispose();
    });

    it('does not fire multiple times when already idle', () => {
        const onIdleStart = vi.fn();
        const onIdleEnd = vi.fn();
        const detector = new IdleDetector(2, { onIdleStart, onIdleEnd });

        // Become idle
        vi.advanceTimersByTime(130_000);
        expect(onIdleStart).toHaveBeenCalledOnce();

        // Stay idle for more time
        vi.advanceTimersByTime(60_000);
        expect(onIdleStart).toHaveBeenCalledOnce(); // still just once

        detector.dispose();
    });
});
