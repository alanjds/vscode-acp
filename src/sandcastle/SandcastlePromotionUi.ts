import * as vscode from 'vscode';

/** Bridge ACP connection used for sandcastle/preview|apply|reject extMethods. */
export interface SandcastleBridgeConnection {
  extMethod(method: string, params: Record<string, unknown>): Promise<Record<string, unknown>>;
}

/** @deprecated Use SandcastleBridgeConnection */
export type SandcastleConnection = SandcastleBridgeConnection;

/** Aperçu des modifications sandbox avant promotion (diff, métadonnées branche/worktree). */
export interface SandcastlePreview {
  diff: string;
  filesChanged: number;
  branch: string;
  baseRef: string;
  worktreePath: string;
}

export type SandcastlePromotionMode = 'ask' | 'autoApply' | 'autoReject';
export type SandcastlePromotionOutcome = 'applied' | 'no_changes' | 'rejected' | 'cancelled';

/**
 * Adapter VS Code + bridge ACP pour les opérations Promotion (preview, apply, reject, diff).
 */
export class SandcastlePromotionUi {
  async preview(connection: SandcastleBridgeConnection, sessionId: string): Promise<SandcastlePreview> {
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

  async apply(connection: SandcastleBridgeConnection, sessionId: string): Promise<boolean> {
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

  async reject(connection: SandcastleBridgeConnection, sessionId: string): Promise<void> {
    const result = await connection.extMethod('sandcastle/reject', { sessionId });
    void vscode.window.showInformationMessage(String(result.message ?? 'Sandcastle changes rejected.'));
  }

  async discard(connection: SandcastleBridgeConnection, sessionId: string): Promise<void> {
    await connection.extMethod('sandcastle/reject', { sessionId });
  }
}
