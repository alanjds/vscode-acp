import * as path from 'path';
import * as vscode from 'vscode';

export type WorkspaceIdentitySource = 'defaultWorkingDirectory' | 'workspace' | 'process';

export interface WorkspaceIdentity {
  key: string;
  cwd: string;
  displayName: string;
  source: WorkspaceIdentitySource;
}

export function normalizeWorkspaceKey(cwd: string): string {
  return path.resolve(cwd).replace(/\\/g, '/');
}

export function workspaceIdentityFromCwd(
  cwd: string,
  source: WorkspaceIdentitySource = 'workspace',
  displayName?: string,
): WorkspaceIdentity {
  const resolved = path.resolve(cwd);
  return {
    key: normalizeWorkspaceKey(resolved),
    cwd: resolved,
    displayName: displayName || path.basename(resolved) || resolved,
    source,
  };
}

export function resolveWorkspaceIdentity(): WorkspaceIdentity {
  const config = vscode.workspace.getConfiguration('acp');
  const defaultWorkingDirectory = config.get<string>('defaultWorkingDirectory')?.trim();
  if (defaultWorkingDirectory) {
    return workspaceIdentityFromCwd(defaultWorkingDirectory, 'defaultWorkingDirectory');
  }

  const activeUri = vscode.window.activeTextEditor?.document.uri;
  const activeFolder = activeUri ? vscode.workspace.getWorkspaceFolder(activeUri) : undefined;
  const folder = activeFolder ?? vscode.workspace.workspaceFolders?.[0];
  if (folder) {
    return workspaceIdentityFromCwd(folder.uri.fsPath, 'workspace', folder.name);
  }

  return workspaceIdentityFromCwd(process.cwd(), 'process');
}

