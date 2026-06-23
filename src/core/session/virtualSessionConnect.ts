import type { InitializeResponse } from '@agentclientprotocol/sdk';
import { PROTOCOL_VERSION } from '@agentclientprotocol/sdk';

import type { OpenSessionOptions, SessionInfo } from './sessionTypes';
import {
  applySharedDiscussionContextHandoff,
  resolveSharedContextForAgentConnect,
} from './sessionSwitchHelpers';
import {
  disconnectCurrentAgentIfNeeded,
  resumeExistingAgentSession,
} from './sessionConnectShared';
import type { SessionConnectorDeps } from './sessionConnectTypes';

/**
 * ConnectedAgent lifecycle for virtual transport (OrchestrationRun).
 */
export async function connectVirtualSession(
  deps: SessionConnectorDeps,
  agentName: string,
  options: OpenSessionOptions = {},
): Promise<SessionInfo> {
  const runtime = deps.getVirtualSessionRuntime();
  if (!runtime) {
    throw new Error('Virtual session runtime is not available.');
  }

  const resumed = resumeExistingAgentSession(deps.sessionState, deps.emit, agentName);
  if (resumed) {
    return resumed;
  }

  const sharedDiscussionContext = resolveSharedContextForAgentConnect(
    deps.discussionContextHandler,
    deps.sessionState,
    options,
    agentName,
  );

  await disconnectCurrentAgentIfNeeded(deps.sessionState, deps.disconnectAgent);

  const cwd = deps.getWorkspaceCwd();
  const descriptor = runtime.createSession(agentName, cwd);
  const { sessionId, agentId, displayName } = descriptor;
  const sessionInfo: SessionInfo = {
    sessionId,
    agentId,
    agentName,
    agentDisplayName: displayName,
    cwd,
    createdAt: new Date().toISOString(),
    initResponse: {
      protocolVersion: PROTOCOL_VERSION,
      agentInfo: {
        name: 'virtual-session',
        title: displayName,
        version: '0.1.0',
      },
      agentCapabilities: {},
    } as InitializeResponse,
    modes: null,
    models: null,
    configOptions: null,
    availableCommands: [],
    title: displayName,
    transport: 'virtual',
  };

  deps.sessionState.addSession(sessionInfo);
  deps.discussionContextHandler.getHistoryStore()?.upsertNew(
    agentName,
    cwd,
    sessionId,
  );
  if (sharedDiscussionContext) {
    applySharedDiscussionContextHandoff(
      deps.discussionContextHandler,
      sharedDiscussionContext,
      agentName,
      sessionId,
      cwd,
      deps.emit.bind(deps),
    );
  }
  deps.sessionState.activateSession(agentName, sessionId);
  deps.emit('agent-connected', agentName);
  deps.emit('active-session-changed', sessionId);
  return sessionInfo;
}
