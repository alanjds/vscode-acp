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

export type SandcastlePromotionMode = 'ask' | 'autoApply' | 'autoReject';

type PromotionChoice = 'diff' | 'apply' | 'reject';

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

  async discard(connection: SandcastleConnection, sessionId: string): Promise<void> {
    await connection.extMethod('sandcastle/reject', { sessionId });
  }

  getPromotionMode(): SandcastlePromotionMode {
    const mode = vscode.workspace.getConfiguration('acp').get<string>('sandcastle.promotion', 'ask');
    if (mode === 'autoApply' || mode === 'autoReject') {
      return mode;
    }
    return 'ask';
  }

  async promote(connection: SandcastleConnection, sessionId: string): Promise<'applied' | 'rejected' | 'cancelled'> {
    const preview = await this.preview(connection, sessionId);
    if (preview.filesChanged === 0) {
      await this.discard(connection, sessionId);
      void vscode.window.showInformationMessage('Sandcastle run completed with no file changes.');
      return 'rejected';
    }

    const mode = this.getPromotionMode();
    if (mode === 'autoApply') {
      return (await this.apply(connection, sessionId)) ? 'applied' : 'cancelled';
    }
    if (mode === 'autoReject') {
      await this.reject(connection, sessionId);
      return 'rejected';
    }

    return this.promptPromotionChoice(connection, sessionId, preview, true);
  }

  private async promptPromotionChoice(
    connection: SandcastleConnection,
    sessionId: string,
    preview: SandcastlePreview,
    allowViewDiff: boolean,
  ): Promise<'applied' | 'rejected' | 'cancelled'> {
    const items: Array<vscode.QuickPickItem & { choice: PromotionChoice }> = [];
    if (allowViewDiff) {
      items.push({
        label: '$(diff) View Diff',
        description: `${preview.filesChanged} file(s) changed`,
        choice: 'diff',
      });
    }
    items.push(
      { label: '$(check) Apply', description: 'Merge sandbox changes into the workspace', choice: 'apply' },
      { label: '$(close) Reject', description: 'Discard sandbox changes', choice: 'reject' },
    );

    const selection = await vscode.window.showQuickPick(items, {
      title: 'Sandcastle changes ready',
      placeHolder: 'Promote sandbox changes to the workspace',
      ignoreFocusOut: true,
    });
    if (!selection) {
      return 'cancelled';
    }

    if (selection.choice === 'diff') {
      await this.showDiff(preview);
      return this.promptPromotionChoice(connection, sessionId, preview, false);
    }
    if (selection.choice === 'reject') {
      await this.reject(connection, sessionId);
      return 'rejected';
    }
    return (await this.apply(connection, sessionId)) ? 'applied' : 'cancelled';
  }
}
