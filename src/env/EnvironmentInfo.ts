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

    let remoteType: RemoteType = 'local';
    let remoteHost: string | null = null;

    if (!remoteName || remoteName === 'undefined') {
        // Running locally, no remote connection
        return { machineName, remoteType: 'local', remoteHost: null };
    }

    // Extract remote authority from workspace folder URI
    // URI authority format: "ssh-remote+hostname", "wsl+DistroName", etc.
    const authority = vscode.workspace.workspaceFolders?.[0]?.uri.authority ?? '';

    if (remoteName === 'ssh-remote') {
        remoteType = 'ssh-remote';
        // authority format: "ssh-remote+hostname" or "ssh-remote+hostname:port"
        const match = authority.match(/^ssh-remote\+(.+?)(?::(\d+))?$/);
        remoteHost = match ? match[1] : authority.replace('ssh-remote+', '') || null;
    } else if (remoteName === 'wsl') {
        remoteType = 'wsl';
        // authority format: "wsl+DistroName"
        remoteHost = authority.replace('wsl+', '') || null;
    } else if (remoteName === 'dev-container' || remoteName === 'attached-container') {
        remoteType = 'dev-container';
        // For containers, use the authority or fallback to hostname
        remoteHost = authority.replace(/^dev-container\+/, '').replace(/^attached-container\+/, '') || machineName;
    } else if (remoteName === 'codespaces') {
        remoteType = 'codespaces';
        remoteHost = authority.replace('codespaces+', '') || null;
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
