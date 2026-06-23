import type { NewSessionResponse } from '@agentclientprotocol/sdk';

import type { ConnectionInfo } from '../ConnectionManager';
import type { WorkspaceIdentity } from '../WorkspaceIdentity';
import { logError } from '../../utils/Logger';
import type { SessionConnectorDeps } from './sessionConnectTypes';
import type { SessionInfo } from './sessionTypes';

export async function createAcpSession(
  deps: Pick<
    SessionConnectorDeps,
    'agentManager' | 'authHandler' | 'sessionState' | 'updateBuffer' | 'discussionContextHandler'
  >,
  agentName: string,
  agentId: string,
  connInfo: ConnectionInfo,
  workspace: WorkspaceIdentity,
  agentFingerprint?: string,
): Promise<SessionInfo> {
  const cwd = workspace.cwd;
  let sessionResponse: NewSessionResponse;
  try {
    sessionResponse = await connInfo.connection.newSession({
      cwd,
      mcpServers: [],
    });
  } catch (e: any) {
    if (!deps.authHandler.isAuthRequiredError(e)) {
      logError('Failed to create session', e);
      deps.agentManager.killAgent(agentId);
      throw e;
    }
    await deps.authHandler.runAuthFlow(agentName, agentId, connInfo);
    try {
      sessionResponse = await connInfo.connection.newSession({
        cwd,
        mcpServers: [],
      });
    } catch (retryErr) {
      logError('Failed to create session after authentication', retryErr);
      deps.agentManager.killAgent(agentId);
      throw retryErr;
    }
  }

  const sessionInfo: SessionInfo = {
    sessionId: sessionResponse.sessionId,
    agentId,
    agentName,
    agentDisplayName: connInfo.initResponse.agentInfo?.title ||
      connInfo.initResponse.agentInfo?.name ||
      agentName,
    cwd,
    createdAt: new Date().toISOString(),
    initResponse: connInfo.initResponse,
    modes: sessionResponse.modes ?? null,
    models: (sessionResponse as any).models ?? null,
    configOptions: (sessionResponse as any).configOptions ?? null,
    availableCommands: [],
    skillsBootstrapped: false,
  };
  deps.sessionState.addSession(sessionInfo);
  deps.updateBuffer.drainInto(sessionInfo);

  deps.discussionContextHandler.getHistoryStore()?.upsertNew(
    agentName,
    workspace,
    sessionInfo.sessionId,
    agentFingerprint,
  );

  return sessionInfo;
}
