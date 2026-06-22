import * as vscode from 'vscode';

interface SandcastleConnection {
  extMethod(method: string, params: Record<string, unknown>): Promise<Record<string, unknown>>;
}

export interface SandcastlePreview {
  diff: string;
  filesChanged: number;
  branch: string;
  baseRef: string;
  worktreePath: string;
}

export class SandcastlePromotionUi {
  async preview(connection: SandcastleConnection, sessionId: string): Promise<SandcastlePreview> {
    const response = await connection.extMethod('sandcastle/preview', { sessionId });
    return {
      diff: String(response.diff ?? ''),
      filesChanged: Number(response.filesChanged ?? 0),
      branch: String(response.branch ?? ''),
      baseRef: String(response.baseRef ?? ''),
      worktreePath: String(response.worktreePath ?? ''),
    };
  }

  async showDiff(preview: SandcastlePreview): Promise<void> {
    const document = await vscode.workspace.openTextDocument({
      language: 'diff',
      content: [
        `# Sandcastle branch: ${preview.branch}`,
        `# Base: ${preview.baseRef}`,
        `# Worktree: ${preview.worktreePath}`,
        '',
        preview.diff || '(no changes)',
      ].join('\n'),
    });
    await vscode.window.showTextDocument(document, {
      preview: true,
      viewColumn: vscode.ViewColumn.Beside,
    });
  }

  async apply(connection: SandcastleConnection, sessionId: string): Promise<boolean> {
    const result = await connection.extMethod('sandcastle/apply', { sessionId });
    const success = result.success === true;
    const message = String(result.message ?? (success ? 'Sandcastle changes applied.' : 'Apply failed.'));
    if (success) {
      void vscode.window.showInformationMessage(message);
    } else {
      void vscode.window.showErrorMessage(message);
    }
    return success;
  }

  async reject(connection: SandcastleConnection, sessionId: string): Promise<void> {
    const result = await connection.extMethod('sandcastle/reject', { sessionId });
    void vscode.window.showInformationMessage(String(result.message ?? 'Sandcastle changes rejected.'));
  }

  async show(connection: SandcastleConnection, sessionId: string): Promise<'applied' | 'rejected' | 'cancelled'> {
    const preview = await this.preview(connection, sessionId);
    if (preview.filesChanged === 0) {
      await this.reject(connection, sessionId);
      void vscode.window.showInformationMessage('Sandcastle run completed with no file changes.');
      return 'rejected';
    }

    while (true) {
      const choice = await vscode.window.showInformationMessage(
        `Sandcastle run changed ${preview.filesChanged} file(s).`,
        { modal: true },
        'View Diff',
        'Apply',
        'Reject',
      );
      if (!choice) {
        return 'cancelled';
      }
      if (choice === 'View Diff') {
        await this.showDiff(preview);
        continue;
      }
      if (choice === 'Reject') {
        await this.reject(connection, sessionId);
        return 'rejected';
      }
      if (await this.apply(connection, sessionId)) {
        return 'applied';
      }
    }
  }
}
