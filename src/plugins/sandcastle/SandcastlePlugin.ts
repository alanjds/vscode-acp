import * as vscode from 'vscode';

import { getAgentConfig, isSandcastleAgentConfig } from '../../config/AgentConfig';
import type { SessionManager } from '../../core/SessionManager';
import { SandcastlePromotionUi } from '../../sandcastle/SandcastlePromotionUi';
import type { FeaturePlugin } from '../FeaturePlugin';

export interface SandcastlePluginContext {
  sessionManager: SessionManager;
}

export class SandcastlePlugin implements FeaturePlugin<SandcastlePluginContext> {
  readonly id = 'sandcastle';

  activate({ sessionManager }: SandcastlePluginContext): vscode.Disposable {
    const resolveActiveSandcastle = () => {
      const activeSession = sessionManager.getActiveSession();
      if (!activeSession) {
        throw new Error('No active ACP session.');
      }
      const config = getAgentConfig(activeSession.agentName);
      if (!config || !isSandcastleAgentConfig(config)) {
        throw new Error('The active agent is not managed by Sandcastle.');
      }
      const connection = sessionManager.getConnectionForSession(activeSession.sessionId);
      if (!connection) {
        throw new Error('The active Sandcastle connection is unavailable.');
      }
      return { activeSession, connection: connection.connection };
    };

    const showDiff = vscode.commands.registerCommand('acp.sandcastle.showDiff', async () => {
      try {
        const { activeSession, connection } = resolveActiveSandcastle();
        const ui = new SandcastlePromotionUi();
        await ui.showDiff(await ui.preview(connection, activeSession.sessionId));
      } catch (error) {
        void vscode.window.showErrorMessage(error instanceof Error ? error.message : String(error));
      }
    });
    const apply = vscode.commands.registerCommand('acp.sandcastle.apply', async () => {
      try {
        const { activeSession, connection } = resolveActiveSandcastle();
        await new SandcastlePromotionUi().apply(connection, activeSession.sessionId);
      } catch (error) {
        void vscode.window.showErrorMessage(error instanceof Error ? error.message : String(error));
      }
    });
    const reject = vscode.commands.registerCommand('acp.sandcastle.reject', async () => {
      try {
        const { activeSession, connection } = resolveActiveSandcastle();
        const confirm = await vscode.window.showWarningMessage(
          'Reject all changes in the active Sandcastle sandbox?',
          { modal: true },
          'Reject',
        );
        if (confirm === 'Reject') {
          await new SandcastlePromotionUi().reject(connection, activeSession.sessionId);
        }
      } catch (error) {
        void vscode.window.showErrorMessage(error instanceof Error ? error.message : String(error));
      }
    });

    return vscode.Disposable.from(showDiff, apply, reject);
  }
}

