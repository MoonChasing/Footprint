import { describe, it, expect } from 'vitest';

/**
 * Tests the line counting logic used in LineChangeCounter.
 * This is isolated from the VSCode dependency.
 */
describe('Line Change Counting Logic', () => {
    // Simulates the counting algorithm from LineChangeCounter
    function countChanges(changes: Array<{ rangeStartLine: number; rangeEndLine: number; text: string }>) {
        let added = 0;
        let deleted = 0;
        for (const change of changes) {
            const linesDeleted = change.rangeEndLine - change.rangeStartLine;
            const linesAdded = (change.text.match(/\n/g) || []).length;
            added += linesAdded;
            deleted += linesDeleted;
        }
        return { added, deleted };
    }

    it('pressing Enter adds one line', () => {
        const result = countChanges([{ rangeStartLine: 5, rangeEndLine: 5, text: '\n' }]);
        expect(result).toEqual({ added: 1, deleted: 0 });
    });

    it('deleting a line removes one line', () => {
        const result = countChanges([{ rangeStartLine: 5, rangeEndLine: 6, text: '' }]);
        expect(result).toEqual({ added: 0, deleted: 1 });
    });

    it('typing a character on a line has no line change', () => {
        const result = countChanges([{ rangeStartLine: 5, rangeEndLine: 5, text: 'a' }]);
        expect(result).toEqual({ added: 0, deleted: 0 });
    });

    it('pasting 5 lines counts correctly', () => {
        const result = countChanges([{ rangeStartLine: 5, rangeEndLine: 5, text: 'line1\nline2\nline3\nline4\nline5' }]);
        expect(result).toEqual({ added: 4, deleted: 0 }); // 4 newlines = 4 lines added
    });

    it('replacing 2 lines with 5 lines', () => {
        const result = countChanges([{ rangeStartLine: 5, rangeEndLine: 7, text: 'a\nb\nc\nd\ne' }]);
        expect(result).toEqual({ added: 4, deleted: 2 });
    });

    it('deleting 3 lines', () => {
        const result = countChanges([{ rangeStartLine: 0, rangeEndLine: 3, text: '' }]);
        expect(result).toEqual({ added: 0, deleted: 3 });
    });

    it('multiple changes in one event', () => {
        const result = countChanges([
            { rangeStartLine: 5, rangeEndLine: 5, text: '\n' },    // +1
            { rangeStartLine: 10, rangeEndLine: 12, text: '' },    // -2
        ]);
        expect(result).toEqual({ added: 1, deleted: 2 });
    });
});
