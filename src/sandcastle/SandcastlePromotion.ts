import * as vscode from 'vscode';

import { getAgentConfig, isSandcastleAgentConfig } from '../config/AgentConfig';
import type { SessionManager } from '../core/SessionManager';
import {
  SandcastlePromotionUi,
  type SandcastleBridgeConnection,
  type SandcastlePreview,
  type SandcastlePromotionMode,
  type SandcastlePromotionOutcome,
} from './SandcastlePromotionUi';
import { decidePromotionPolicy } from './PromotionPolicy';

export type { SandcastlePromotionMode, SandcastlePromotionOutcome };

export class SandcastleApplyError extends Error {
  constructor() {
    super('Sandcastle changes could not be applied.');
  }
}

export interface FinishEphemeralRunOptions {
  sideEffects?: 'none' | 'workspace';
}

type PromotionChoice = 'diff' | 'apply' | 'reject';

/**
 * Façade de promotion Sandcastle côté extension VS Code.
 * Résout la session ACP active pour les commandes palette ; orchestre Promotion après EphemeralRun.
 */
export class SandcastlePromotion {
  constructor(
    private readonly sessions: SessionManager,
    private readonly ui: SandcastlePromotionUi = new SandcastlePromotionUi(),
  ) {}

  /**
   * Affiche le diff des changements du sandbox actif dans un document VS Code.
   */
  async showDiff(): Promise<void> {
    const { connection, sessionId } = this.resolveActiveSandbox();
    await this.ui.showDiff(await this.ui.preview(connection, sessionId));
  }

  /**
   * Applique les changements du sandbox actif sur le workspace hôte.
   */
  async apply(): Promise<void> {
    const { connection, sessionId } = this.resolveActiveSandbox();
    await this.ui.apply(connection, sessionId);
  }

  /**
   * Rejette et détruit les changements du sandbox de la session active.
   */
  async reject(): Promise<void> {
    const { connection, sessionId } = this.resolveActiveSandbox();
    await this.ui.reject(connection, sessionId);
  }

  /**
   * Termine un EphemeralRun Sandcastle : discard silencieux ou gate Promotion selon sideEffects.
   *
   * @returns Outcome Promotion quand sideEffects vaut workspace ; sinon undefined après discard.
   * @throws {@link SandcastleApplyError} Si apply échoue en mode autoApply ou après choix Apply.
   */
  async finishEphemeralRun(
    connection: SandcastleBridgeConnection,
    sessionId: string,
    options: FinishEphemeralRunOptions = {},
  ): Promise<SandcastlePromotionOutcome | undefined> {
    const sideEffects = options.sideEffects ?? 'none';
    if (sideEffects !== 'workspace') {
      await this.ui.discard(connection, sessionId);
      return undefined;
    }

    const outcome = await this.promote(connection, sessionId);
    if (outcome === 'cancelled') {
      await this.ui.discard(connection, sessionId);
    }
    return outcome;
  }

  /**
   * Exécute le flux Promotion post-run selon le mode configuré (ask, autoApply, autoReject).
   */
  async promote(connection: SandcastleBridgeConnection, sessionId: string): Promise<SandcastlePromotionOutcome> {
    const preview = await this.ui.preview(connection, sessionId);
    const decision = decidePromotionPolicy(preview, this.getPromotionMode());

    if (decision === 'discard_no_changes') {
      await this.ui.discard(connection, sessionId);
      void vscode.window.showInformationMessage('Sandcastle run completed with no file changes.');
      return 'no_changes';
    }
    if (decision === 'auto_apply') {
      if (!(await this.ui.apply(connection, sessionId))) {
        throw new SandcastleApplyError();
      }
      return 'applied';
    }
    if (decision === 'auto_reject') {
      await this.ui.reject(connection, sessionId);
      return 'rejected';
    }

    return this.promptPromotionChoice(connection, sessionId, preview, true);
  }

  private getPromotionMode(): SandcastlePromotionMode {
    const mode = vscode.workspace.getConfiguration('acp').get<string>('sandcastle.promotion', 'ask');
    if (mode === 'autoApply' || mode === 'autoReject') {
      return mode;
    }
    return 'ask';
  }

  private async promptPromotionChoice(
    connection: SandcastleBridgeConnection,
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
      await this.ui.showDiff(preview);
      return this.promptPromotionChoice(connection, sessionId, preview, false);
    }
    if (selection.choice === 'reject') {
      await this.ui.reject(connection, sessionId);
      return 'rejected';
    }
    if (!(await this.ui.apply(connection, sessionId))) {
      throw new SandcastleApplyError();
    }
    return 'applied';
  }

  private resolveActiveSandbox() {
    const activeSession = this.sessions.getActiveSession();
    if (!activeSession) {
      throw new Error('No active ACP session.');
    }
    const config = getAgentConfig(activeSession.agentName);
    if (!config || !isSandcastleAgentConfig(config)) {
      throw new Error('The active agent is not managed by Sandcastle.');
    }
    const connection = this.sessions.getConnectionForSession(activeSession.sessionId);
    if (!connection) {
      throw new Error('The active Sandcastle connection is unavailable.');
    }
    return { sessionId: activeSession.sessionId, connection: connection.connection };
  }
}
