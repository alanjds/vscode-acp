import { getAgentConfig, isSandcastleAgentConfig } from '../config/AgentConfig';
import type { SessionManager } from '../core/SessionManager';
import { SandcastlePromotionUi } from './SandcastlePromotionUi';

/** Concentrates active-session resolution, validation and promotion actions. */
export class SandcastlePromotion {
  constructor(
    private readonly sessions: SessionManager,
    private readonly ui: SandcastlePromotionUi = new SandcastlePromotionUi(),
  ) {}

  async showDiff(): Promise<void> {
    const { connection, sessionId } = this.resolveActiveSandbox();
    await this.ui.showDiff(await this.ui.preview(connection, sessionId));
  }

  async apply(): Promise<void> {
    const { connection, sessionId } = this.resolveActiveSandbox();
    await this.ui.apply(connection, sessionId);
  }

  async reject(): Promise<void> {
    const { connection, sessionId } = this.resolveActiveSandbox();
    await this.ui.reject(connection, sessionId);
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
