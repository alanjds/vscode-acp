import * as vscode from 'vscode';

import type { SessionManager } from '../../core/SessionManager';
import { SandcastlePromotion } from '../../sandcastle/SandcastlePromotion';
import type { FeaturePlugin } from '../FeaturePlugin';

export interface SandcastlePluginContext {
  sessionManager: SessionManager;
}

export class SandcastlePlugin implements FeaturePlugin<SandcastlePluginContext> {
  readonly id = 'sandcastle';

  activate({ sessionManager }: SandcastlePluginContext): vscode.Disposable {
    const promotion = new SandcastlePromotion(sessionManager);

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
