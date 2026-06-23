import type { ConnectionInfo } from '../ConnectionManager';
import { classifyAgentError } from '../AgentError';
import { log, logError } from '../../utils/Logger';
import { sendEvent, sendError } from '../../utils/TelemetryManager';
import { spawnAndConnectNativeAgent } from './nativeAgentConnection';
import { createAcpSession } from './acpSessionFactory';
import {
  disconnectCurrentAgentIfNeeded,
  resumeExistingAgentSession,
} from './sessionConnectShared';
import type { SessionConnectorDeps } from './sessionConnectTypes';
import type { OpenSessionOptions, SessionInfo } from './sessionTypes';
import {
  applySharedDiscussionContextHandoff,
  fingerprintAgentConfig,
  prepareSkillsForAgent,
  resolveSharedContextForAgentConnect,
} from './sessionSwitchHelpers';

export function recordAgentConnectionFailure(
  deps: Pick<SessionConnectorDeps, 'discussionContextHandler' | 'emit'>,
  agentName: string,
  error: unknown,
): void {
  const classified = classifyAgentError(error);
  if (classified.kind === 'missing-pipeline-agent') {
    deps.discussionContextHandler.getHistoryStore()?.markAgentStatus(agentName, 'agentRemoved');
  } else if (classified.kind !== 'auth-cancelled') {
    deps.discussionContextHandler.getHistoryStore()?.markAgentStatus(agentName, 'agentUnavailable');
  }
  deps.emit('agent-error', agentName, error);
}

function registerNativeAgentProcessListeners(
  deps: Pick<SessionConnectorDeps, 'agentManager' | 'sessionState' | 'emit'>,
  agentName: string,
  agentId: string,
): void {
  deps.agentManager.on('agent-error', (evt: { agentId: string; error: Error }) => {
    if (evt.agentId === agentId) {
      logError(`Agent ${agentName} error`, evt.error);
      deps.emit('agent-error', agentId, evt.error);
    }
  });

  deps.agentManager.on('agent-closed', (evt: { agentId: string; code: number | null }) => {
    if (evt.agentId === agentId) {
      log(`Agent ${agentName} closed with code ${evt.code}`);
      const sessionId = deps.sessionState.getAgentSession(agentName);
      if (sessionId) {
        deps.sessionState.removeSessionForAgent(agentName);
        deps.emit('agent-disconnected', agentName);
        deps.emit('active-session-changed', null);
      }
      deps.emit('agent-closed', agentId, evt.code);
    }
  });
}

/**
 * ConnectedAgent lifecycle for nativeAcp and sandcastle transports.
 */
export async function connectNativeAgentSession(
  deps: SessionConnectorDeps,
  agentName: string,
  options: OpenSessionOptions = {},
): Promise<SessionInfo> {
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

  const configs = deps.getConfigs();
  const config = configs[agentName];
  if (!config) {
    throw new Error(`Unknown agent: ${agentName}. Available: ${Object.keys(configs).join(', ')}`);
  }

  log(`SessionManager: connecting to agent "${agentName}"`);
  sendEvent('agent/connect.start', { agentName });
  const connectStartTime = Date.now();

  try {
    const workspace = deps.getWorkspaceIdentity();
    const workspaceCwd = workspace.cwd;

    prepareSkillsForAgent(agentName, workspaceCwd);

    const { agentId, connInfo } = await spawnAndConnectNativeAgent({
      agentManager: deps.agentManager,
      connectionManager: deps.connectionManager,
      agentName,
      config,
      workspaceCwd,
    });

    registerNativeAgentProcessListeners(deps, agentName, agentId);

    const sessionInfo = await createAcpSession(
      deps,
      agentName,
      agentId,
      connInfo,
      workspace,
      fingerprintAgentConfig(config),
    );

    if (sharedDiscussionContext) {
      applySharedDiscussionContextHandoff(
        deps.discussionContextHandler,
        sharedDiscussionContext,
        agentName,
        sessionInfo.sessionId,
        workspace,
        deps.emit.bind(deps),
      );
    }

    deps.sessionState.activateSession(agentName, sessionInfo.sessionId);
    deps.emit('agent-connected', agentName);
    deps.emit('active-session-changed', sessionInfo.sessionId);

    log(`Connected to agent ${agentName}, session ${sessionInfo.sessionId}`);
    sendEvent('agent/connect.end', { agentName, result: 'success' }, { duration: Date.now() - connectStartTime });
    return sessionInfo;
  } catch (e: any) {
    recordAgentConnectionFailure(deps, agentName, e);
    sendError('agent/connect.end', { agentName, result: 'error', errorMessage: e.message || String(e) }, { duration: Date.now() - connectStartTime });
    throw e;
  }
}

export async function ensureNativeAgentConnected(
  deps: SessionConnectorDeps,
  agentName: string,
): Promise<ConnectionInfo> {
  const existingSessionId = deps.sessionState.getAgentSession(agentName);
  if (existingSessionId) {
    const existing = deps.sessionState.getSession(existingSessionId);
    if (existing) {
      const conn = deps.connectionManager.getConnection(existing.agentId);
      if (conn) {
        const caps = deps.sessionState.summarizeCapabilities(conn.initResponse.agentCapabilities);
        deps.sessionState.setCapabilities(agentName, caps);
        return conn;
      }
    }
  }

  for (const instance of deps.agentManager.getRunningAgents()) {
    if (instance.name === agentName) {
      const conn = deps.connectionManager.getConnection(instance.id);
      if (conn) {
        const caps = deps.sessionState.summarizeCapabilities(conn.initResponse.agentCapabilities);
        deps.sessionState.setCapabilities(agentName, caps);
        return conn;
      }
    }
  }

  const configs = deps.getConfigs();
  const config = configs[agentName];
  if (!config) {
    deps.discussionContextHandler.getHistoryStore()?.markAgentStatus(agentName, 'agentRemoved');
    throw new Error(`Unknown agent: ${agentName}.`);
  }

  const workspaceCwd = deps.getWorkspaceCwd();
  let connInfo: ConnectionInfo;
  try {
    ({ connInfo } = await spawnAndConnectNativeAgent({
      agentManager: deps.agentManager,
      connectionManager: deps.connectionManager,
      agentName,
      config,
      workspaceCwd,
    }));
  } catch (e) {
    recordAgentConnectionFailure(deps, agentName, e);
    throw e;
  }

  const caps = deps.sessionState.summarizeCapabilities(connInfo.initResponse.agentCapabilities);
  deps.sessionState.setCapabilities(agentName, caps);
  return connInfo;
}

export function findAgentIdForConnection(
  deps: Pick<SessionConnectorDeps, 'sessionState' | 'connectionManager' | 'agentManager'>,
  conn: ConnectionInfo,
): string | undefined {
  for (const session of deps.sessionState.getAllSessions().values()) {
    const c = deps.connectionManager.getConnection(session.agentId);
    if (c === conn) {
      return session.agentId;
    }
  }
  for (const instance of deps.agentManager.getRunningAgents()) {
    if (deps.connectionManager.getConnection(instance.id) === conn) {
      return instance.id;
    }
  }
  return undefined;
}
