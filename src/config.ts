import * as vscode from 'vscode';
import { TimeTrackConfig } from './types';

/**
 * Reads extension configuration from VS Code settings.
 */
export function getConfig(): TimeTrackConfig {
    const config = vscode.workspace.getConfiguration('timetrack');
    return {
        idleTimeout: config.get<number>('idleTimeout', 2),
        heartbeatInterval: config.get<number>('heartbeatInterval', 30),
        excludePatterns: config.get<string[]>('excludePatterns', ['**/.git/**', '**/node_modules/**']),
        showStatusBar: config.get<boolean>('showStatusBar', true),
        trackUntitled: config.get<boolean>('trackUntitled', false),
    };
}

/**
 * Check if a file path should be excluded from tracking.
 */
export function shouldExcludeFile(filePath: string, excludePatterns: string[]): boolean {
    for (const pattern of excludePatterns) {
        // Simple glob matching: convert pattern to regex
        const regexStr = pattern
            .replace(/\*\*/g, '<<<GLOBSTAR>>>')
            .replace(/\*/g, '[^/]*')
            .replace(/<<<GLOBSTAR>>>/g, '.*')
            .replace(/\?/g, '.');
        const regex = new RegExp(regexStr);
        if (regex.test(filePath)) {
            return true;
        }
    }
    return false;
}
