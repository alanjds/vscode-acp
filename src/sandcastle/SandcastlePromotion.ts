import { getAgentConfig, isSandcastleAgentConfig } from '../config/AgentConfig';
import type { SessionManager } from '../core/SessionManager';
import { SandcastlePromotionUi } from './SandcastlePromotionUi';

/**
 * Façade de promotion Sandcastle côté extension VS Code.
 * Résout la session ACP active, valide qu'elle est gérée par Sandcastle, puis délègue à l'UI (diff, apply, reject).
 */
export class SandcastlePromotion {
  constructor(
    private readonly sessions: SessionManager,
    private readonly ui: SandcastlePromotionUi = new SandcastlePromotionUi(),
  ) {}

  /**
   * Affiche le diff des changements du sandbox actif dans un document VS Code.
   *
   * @returns Promise résolue après ouverture du document diff.
   * @throws Si aucune session active, agent non Sandcastle, ou connexion indisponible.
   */
  async showDiff(): Promise<void> {
    const { connection, sessionId } = this.resolveActiveSandbox();
    await this.ui.showDiff(await this.ui.preview(connection, sessionId));
  }

  /**
   * Applique les changements du sandbox actif sur le workspace hôte.
   *
   * @returns Promise résolue après tentative d'apply via le bridge ACP.
   * @throws Si la session active n'est pas une session Sandcastle valide.
   */
  async apply(): Promise<void> {
    const { connection, sessionId } = this.resolveActiveSandbox();
    await this.ui.apply(connection, sessionId);
  }

  /**
   * Rejette et détruit les changements du sandbox de la session active.
   *
   * @returns Promise résolue après appel `sandcastle/reject` sur le bridge.
   * @throws Si la résolution de session active échoue.
   */
  async reject(): Promise<void> {
    const { connection, sessionId } = this.resolveActiveSandbox();
    await this.ui.reject(connection, sessionId);
  }

  /**
   * Détermine la session Sandcastle active et sa connexion ACP pour les commandes de promotion.
   *
   * @returns Identifiant de session et connexion permettant les `extMethod` Sandcastle.
   * @throws Si pas de session active, agent non Sandcastle, ou connexion manquante.
   */
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
