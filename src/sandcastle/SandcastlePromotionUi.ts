import * as vscode from 'vscode';

interface SandcastleConnection {
  extMethod(method: string, params: Record<string, unknown>): Promise<Record<string, unknown>>;
}

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

export class SandcastleApplyError extends Error {
  constructor() {
    super('Sandcastle changes could not be applied.');
  }
}

type PromotionChoice = 'diff' | 'apply' | 'reject';

/**
 * Couche UI VS Code pour la promotion Sandcastle.
 * Orchestre preview, affichage du diff, apply/reject et le flux interactif ou automatique après un run.
 */
export class SandcastlePromotionUi {
  /**
   * Demande au bridge ACP un aperçu des changements du sandbox pour une session.
   *
   * @param connection - Connexion ACP supportant `extMethod`.
   * @param sessionId - Identifiant de la session Sandcastle.
   * @returns Structure typée avec diff et compteurs de fichiers.
   */
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

  /**
   * Ouvre un document diff en lecture seule avec le patch et les métadonnées de branche.
   *
   * @param preview - Aperçu retourné par `preview` ou `sandcastle/preview`.
   * @returns Promise résolue après affichage du document dans une colonne adjacente.
   */
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

  /**
   * Applique les changements sandbox sur le workspace via `sandcastle/apply` et notifie l'utilisateur.
   *
   * @param connection - Connexion ACP vers le bridge Sandcastle.
   * @param sessionId - Session dont les changements doivent être promus.
   * @returns `true` si l'apply a réussi, `false` sinon.
   */
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

  /**
   * Rejette les changements sandbox et affiche le message de confirmation du bridge.
   *
   * @param connection - Connexion ACP vers le bridge Sandcastle.
   * @param sessionId - Session dont le sandbox doit être détruit.
   * @returns Promise résolue après notification utilisateur.
   */
  async reject(connection: SandcastleConnection, sessionId: string): Promise<void> {
    const result = await connection.extMethod('sandcastle/reject', { sessionId });
    void vscode.window.showInformationMessage(String(result.message ?? 'Sandcastle changes rejected.'));
  }

  /**
   * Rejette silencieusement le sandbox (sans toast) — utilisé quand il n'y a aucun changement.
   *
   * @param connection - Connexion ACP vers le bridge Sandcastle.
   * @param sessionId - Session à nettoyer.
   * @returns Promise résolue après `sandcastle/reject`.
   */
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

  /**
   * Exécute le flux de promotion post-run selon le mode configuré (ask, autoApply, autoReject).
   *
   * @param connection - Connexion ACP active pour la session.
   * @param sessionId - Session terminée dont les changements sont à traiter.
   * @returns Issue du flux : appliqué, sans changement, rejeté ou annulé par l'utilisateur.
   * @throws {@link SandcastleApplyError} Si l'apply automatique ou manuel échoue.
   */
  async promote(connection: SandcastleConnection, sessionId: string): Promise<SandcastlePromotionOutcome> {
    const preview = await this.preview(connection, sessionId);
    if (preview.filesChanged === 0) {
      await this.discard(connection, sessionId);
      void vscode.window.showInformationMessage('Sandcastle run completed with no file changes.');
      return 'no_changes';
    }

    const mode = this.getPromotionMode();
    if (mode === 'autoApply') {
      if (!(await this.apply(connection, sessionId))) {
        throw new SandcastleApplyError();
      }
      return 'applied';
    }
    if (mode === 'autoReject') {
      await this.reject(connection, sessionId);
      return 'rejected';
    }

    return this.promptPromotionChoice(connection, sessionId, preview, true);
  }

  /**
   * Présente une quick pick pour choisir entre voir le diff, appliquer ou rejeter les changements.
   *
   * @param connection - Connexion ACP pour apply/reject ultérieurs.
   * @param sessionId - Session concernée par la promotion.
   * @param preview - Aperçu déjà calculé des modifications.
   * @param allowViewDiff - Si `true`, propose l'option « View Diff » (désactivée après un premier affichage).
   * @returns Issue du choix utilisateur ou du sous-flux récursif après consultation du diff.
   * @throws {@link SandcastleApplyError} Si l'utilisateur choisit Apply et que l'opération échoue.
   */
  private async promptPromotionChoice(
    connection: SandcastleConnection,
    sessionId: string,
    preview: SandcastlePreview,
    allowViewDiff: boolean,
  ): Promise<SandcastlePromotionOutcome> {
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
    if (!(await this.apply(connection, sessionId))) {
      throw new SandcastleApplyError();
    }
    return 'applied';
  }
}
