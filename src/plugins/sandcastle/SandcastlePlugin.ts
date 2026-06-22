import * as vscode from 'vscode';

import type { SessionManager } from '../../core/SessionManager';
import type { SandcastlePromotion } from '../../sandcastle/SandcastlePromotion';
import { SandcastlePromotion as SandcastlePromotionImpl } from '../../sandcastle/SandcastlePromotion';
import type { FeaturePlugin } from '../FeaturePlugin';

export interface SandcastlePluginContext {
  sessionManager: SessionManager;
  sandcastlePromotion?: SandcastlePromotion;
}

/**
 * Plugin d'extension VS Code pour Sandcastle.
 * Enregistre les commandes de promotion (diff, apply, reject) sur la session ACP active.
 */
export class SandcastlePlugin implements FeaturePlugin<SandcastlePluginContext> {
  readonly id = 'sandcastle';

  /**
   * Active le plugin : enregistre les commandes `acp.sandcastle.*` et branche la façade {@link SandcastlePromotion}.
   *
   * @param context - Contexte d'activation contenant le gestionnaire de sessions ACP.
   * @returns Disposable regroupant les abonnements aux commandes VS Code.
   */
  activate({ sessionManager, sandcastlePromotion }: SandcastlePluginContext): vscode.Disposable {
    const promotion = sandcastlePromotion ?? new SandcastlePromotionImpl(sessionManager);

    const showDiff = vscode.commands.registerCommand('acp.sandcastle.showDiff', async () => {
      try {
        await promotion.showDiff();
      } catch (error) {
        void vscode.window.showErrorMessage(error instanceof Error ? error.message : String(error));
      }
    });
    const apply = vscode.commands.registerCommand('acp.sandcastle.apply', async () => {
      try {
        await promotion.apply();
      } catch (error) {
        void vscode.window.showErrorMessage(error instanceof Error ? error.message : String(error));
      }
    });
    const reject = vscode.commands.registerCommand('acp.sandcastle.reject', async () => {
      try {
        const confirm = await vscode.window.showWarningMessage(
          'Reject all changes in the active Sandcastle sandbox?',
          { modal: true },
          'Reject',
        );
        if (confirm === 'Reject') {
          await promotion.reject();
        }
      } catch (error) {
        void vscode.window.showErrorMessage(error instanceof Error ? error.message : String(error));
      }
    });

    return vscode.Disposable.from(showDiff, apply, reject);
  }
}
