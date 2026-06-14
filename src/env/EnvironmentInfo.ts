import * as vscode from 'vscode';
import * as os from 'os';
import { EnvironmentContext, RemoteType } from '../types';

/**
 * Detects the current VSCode environment context:
 * machine name, remote type, and remote host identifier.
 */
export function getEnvironmentContext(): EnvironmentContext {
    const machineName = os.hostname();
    const remoteName = vscode.env.remoteName;
    const remoteAuthority = vscode.env.remoteAuthority;

    let remoteType: RemoteType = 'local';
    let remoteHost: string | null = null;

    if (remoteName === 'ssh-remote') {
        remoteType = 'ssh-remote';
        // remoteAuthority format: "ssh-remote+hostname[:port]"
        if (remoteAuthority) {
            const match = remoteAuthority.match(/^ssh-remote\+(.+?)(?::(\d+))?$/);
            remoteHost = match ? match[1] : remoteAuthority.replace('ssh-remote+', '');
        }
    } else if (remoteName === 'wsl') {
        remoteType = 'wsl';
        // remoteAuthority format: "wsl+DistroName"
        if (remoteAuthority) {
            remoteHost = remoteAuthority.replace('wsl+', '');
        }
    } else if (remoteName === 'dev-container' || remoteName === 'attached-container') {
        remoteType = 'dev-container';
        // For containers, use the hostname (container ID) as identifier
        remoteHost = machineName;
    } else if (remoteName === 'codespaces') {
        remoteType = 'codespaces';
        remoteHost = remoteAuthority?.replace('codespaces+', '') ?? null;
    }

    return { machineName, remoteType, remoteHost };
}

/**
 * Gets the project context for a given file URI.
 * Returns the workspace folder that contains the file.
 */
export function getProjectContext(fileUri: vscode.Uri): { projectPath: string; projectName: string } {
    const workspaceFolder = vscode.workspace.getWorkspaceFolder(fileUri);
    if (workspaceFolder) {
        return {
            projectPath: workspaceFolder.uri.fsPath,
            projectName: workspaceFolder.name,
        };
    }
    // Fallback: use the workspace name or "Unknown"
    return {
        projectPath: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? 'unknown',
        projectName: vscode.workspace.name ?? 'Unknown',
    };
}
