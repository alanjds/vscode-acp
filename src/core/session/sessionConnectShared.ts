import type { SessionState } from '../SessionState';
import type { SessionInfo } from './sessionTypes';
import type { SessionConnectorEmitter } from './sessionConnectTypes';

export function resumeExistingAgentSession(
  sessionState: SessionState,
  emit: SessionConnectorEmitter,
  agentName: string,
): SessionInfo | null {
  const existingSessionId = sessionState.getAgentSession(agentName);
  if (existingSessionId && sessionState.getSession(existingSessionId)) {
    sessionState.setActiveSessionId(existingSessionId);
    emit('active-session-changed', existingSessionId);
    return sessionState.getSession(existingSessionId)!;
  }
  return null;
}

export async function disconnectCurrentAgentIfNeeded(
  sessionState: SessionState,
  disconnectAgent: (agentName: string) => Promise<void>,
): Promise<void> {
  const currentAgent = sessionState.getActiveAgentName();
  if (currentAgent) {
    await disconnectAgent(currentAgent);
  }
}
