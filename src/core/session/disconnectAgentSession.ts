import { log } from '../../utils/Logger';
import { sendEvent } from '../../utils/TelemetryManager';
import type { SessionConnectorDeps } from './sessionConnectTypes';

export async function disconnectAgentSession(
  deps: Pick<
    SessionConnectorDeps,
    'sessionState' | 'agentManager' | 'connectionManager' | 'getVirtualSessionRuntime' | 'emit'
  >,
  agentName: string,
): Promise<void> {
  const sessionId = deps.sessionState.getAgentSession(agentName);
  if (!sessionId) {
    return;
  }

  const session = deps.sessionState.getSession(sessionId);
  if (!session) {
    return;
  }

  log(`Disconnecting agent ${agentName}`);
  sendEvent('agent/disconnect', { agentName });

  if (session.transport === 'virtual') {
    deps.getVirtualSessionRuntime()?.cancel(session.sessionId);
  } else {
    deps.agentManager.killAgent(session.agentId);
    deps.connectionManager.removeConnection(session.agentId);
  }
  deps.sessionState.removeSessionForAgent(agentName);

  deps.emit('agent-disconnected', agentName);
  deps.emit('active-session-changed', null);
}
