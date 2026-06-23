import type { NewSessionResponse, InitializeResponse } from '@agentclientprotocol/sdk';
import { PROTOCOL_VERSION } from '@agentclientprotocol/sdk';

import { AgentManager } from '../AgentManager';
import { ConnectionManager, ConnectionInfo } from '../ConnectionManager';
import { SessionAuthHandler } from '../SessionAuthHandler';
import { DiscussionContextHandler } from '../DiscussionContextHandler';
import { SessionState } from '../SessionState';
import { SessionUpdateBuffer } from '../SessionUpdateBuffer';
import { classifyAgentError } from '../AgentError';
import type { WorkspaceIdentity } from '../WorkspaceIdentity';
import { isSandcastleAgentConfig } from '../../config/AgentConfig';
import { log, logError } from '../../utils/Logger';
import { sendEvent, sendError } from '../../utils/TelemetryManager';
import type { VirtualSessionRuntime } from '../VirtualSessionRuntime';
import type { OpenSessionOptions, SessionInfo } from './sessionTypes';
import {
  applySharedDiscussionContextHandoff,
  fingerprintAgentConfig,
  prepareSkillsForAgent,
  resolveSharedContextForAgentConnect,
} from './sessionSwitchHelpers';

export type SessionConnectorEmitter = (
  event: string,
  ...args: any[]
) => boolean;

export interface SessionConnectorDeps {
  agentManager: AgentManager;
  connectionManager: ConnectionManager;
  sessionState: SessionState;
  updateBuffer: SessionUpdateBuffer;
  authHandler: SessionAuthHandler;
  discussionContextHandler: DiscussionContextHandler;
  getConfigs: () => Record<string, any>;
  getWorkspaceIdentity: () => WorkspaceIdentity;
  getWorkspaceCwd: () => string;
  getVirtualSessionRuntime: () => VirtualSessionRuntime | null;
  disconnectAgent: (agentName: string) => Promise<void>;
  emit: SessionConnectorEmitter;
}

export class SessionConnector {
  constructor(private readonly deps: SessionConnectorDeps) {}

  async connectToAgent(agentName: string, options: OpenSessionOptions = {}): Promise<SessionInfo> {
    if (this.deps.getVirtualSessionRuntime()?.canHandle(agentName)) {
      return this.connectToVirtualAgent(agentName, options);
    }

    const existingSessionId = this.deps.sessionState.getAgentSession(agentName);
    if (existingSessionId && this.deps.sessionState.getSession(existingSessionId)) {
      this.deps.sessionState.setActiveSessionId(existingSessionId);
      this.deps.emit('active-session-changed', existingSessionId);
      return this.deps.sessionState.getSession(existingSessionId)!;
    }

    const sharedDiscussionContext = resolveSharedContextForAgentConnect(
      this.deps.discussionContextHandler,
      this.deps.sessionState,
      options,
      agentName,
    );

    const currentAgent = this.deps.sessionState.getActiveAgentName();
    if (currentAgent) {
      await this.deps.disconnectAgent(currentAgent);
    }

    const configs = this.deps.getConfigs();
    const config = configs[agentName];
    if (!config) {
      throw new Error(`Unknown agent: ${agentName}. Available: ${Object.keys(configs).join(', ')}`);
    }

    log(`SessionManager: connecting to agent "${agentName}"`);
    sendEvent('agent/connect.start', { agentName });
    const connectStartTime = Date.now();

    try {
      const workspace = this.deps.getWorkspaceIdentity();
      const workspaceCwd = workspace.cwd;

      prepareSkillsForAgent(agentName, workspaceCwd);

      const agentInstance = this.deps.agentManager.spawnAgent(agentName, config, workspaceCwd);
      const agentId = agentInstance.id;

      this.deps.agentManager.on('agent-error', (evt: { agentId: string; error: Error }) => {
        if (evt.agentId === agentId) {
          logError(`Agent ${agentName} error`, evt.error);
          this.deps.emit('agent-error', agentId, evt.error);
        }
      });

      this.deps.agentManager.on('agent-closed', (evt: { agentId: string; code: number | null }) => {
        if (evt.agentId === agentId) {
          log(`Agent ${agentName} closed with code ${evt.code}`);
          const sessionId = this.deps.sessionState.getAgentSession(agentName);
          if (sessionId) {
            this.deps.sessionState.removeSessionForAgent(agentName);
            this.deps.emit('agent-disconnected', agentName);
            this.deps.emit('active-session-changed', null);
          }
          this.deps.emit('agent-closed', agentId, evt.code);
        }
      });

      const agentProcess = this.deps.agentManager.getAgent(agentId);
      if (!agentProcess) {
        throw new Error('Agent process not found after spawn');
      }

      let connInfo: ConnectionInfo;
      try {
        connInfo = await this.deps.connectionManager.connect(
          agentId,
          agentProcess.process,
          workspaceCwd,
          { autoApproveAll: isSandcastleAgentConfig(config) },
        );
      } catch (e) {
        this.deps.agentManager.killAgent(agentId);
        throw e;
      }

      const sessionInfo = await this.createAcpSession(
        agentName,
        agentId,
        connInfo,
        workspace,
        fingerprintAgentConfig(config),
      );

      if (sharedDiscussionContext) {
        applySharedDiscussionContextHandoff(
          this.deps.discussionContextHandler,
          sharedDiscussionContext,
          agentName,
          sessionInfo.sessionId,
          workspace,
          this.deps.emit.bind(this.deps),
        );
      }

      this.deps.sessionState.activateSession(agentName, sessionInfo.sessionId);

      this.deps.emit('agent-connected', agentName);
      this.deps.emit('active-session-changed', sessionInfo.sessionId);

      log(`Connected to agent ${agentName}, session ${sessionInfo.sessionId}`);
      sendEvent('agent/connect.end', { agentName, result: 'success' }, { duration: Date.now() - connectStartTime });
      return sessionInfo;
    } catch (e: any) {
      this.recordAgentConnectionFailure(agentName, e);
      sendError('agent/connect.end', { agentName, result: 'error', errorMessage: e.message || String(e) }, { duration: Date.now() - connectStartTime });
      throw e;
    }
  }

  async connectToVirtualAgent(agentName: string, options: OpenSessionOptions = {}): Promise<SessionInfo> {
    const runtime = this.deps.getVirtualSessionRuntime();
    if (!runtime) {
      throw new Error('Virtual session runtime is not available.');
    }
    const existingSessionId = this.deps.sessionState.getAgentSession(agentName);
    if (existingSessionId && this.deps.sessionState.getSession(existingSessionId)) {
      this.deps.sessionState.setActiveSessionId(existingSessionId);
      this.deps.emit('active-session-changed', existingSessionId);
      return this.deps.sessionState.getSession(existingSessionId)!;
    }

    const sharedDiscussionContext = resolveSharedContextForAgentConnect(
      this.deps.discussionContextHandler,
      this.deps.sessionState,
      options,
      agentName,
    );

    const currentAgent = this.deps.sessionState.getActiveAgentName();
    if (currentAgent) {
      await this.deps.disconnectAgent(currentAgent);
    }

    const cwd = this.deps.getWorkspaceCwd();
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

    this.deps.sessionState.addSession(sessionInfo);
    this.deps.discussionContextHandler.getHistoryStore()?.upsertNew(
      agentName,
      cwd,
      sessionId,
    );
    if (sharedDiscussionContext) {
      applySharedDiscussionContextHandoff(
        this.deps.discussionContextHandler,
        sharedDiscussionContext,
        agentName,
        sessionId,
        cwd,
        this.deps.emit.bind(this.deps),
      );
    }
    this.deps.sessionState.activateSession(agentName, sessionId);
    this.deps.emit('agent-connected', agentName);
    this.deps.emit('active-session-changed', sessionId);
    return sessionInfo;
  }

  async disconnectAgent(agentName: string): Promise<void> {
    const sessionId = this.deps.sessionState.getAgentSession(agentName);
    if (!sessionId) { return; }

    const session = this.deps.sessionState.getSession(sessionId);
    if (!session) { return; }

    log(`Disconnecting agent ${agentName}`);
    sendEvent('agent/disconnect', { agentName });

    if (session.transport === 'virtual') {
      this.deps.getVirtualSessionRuntime()?.cancel(session.sessionId);
    } else {
      this.deps.agentManager.killAgent(session.agentId);
      this.deps.connectionManager.removeConnection(session.agentId);
    }
    this.deps.sessionState.removeSessionForAgent(agentName);

    this.deps.emit('agent-disconnected', agentName);
    this.deps.emit('active-session-changed', null);
  }

  async createAcpSession(
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
      if (!this.deps.authHandler.isAuthRequiredError(e)) {
        logError('Failed to create session', e);
        this.deps.agentManager.killAgent(agentId);
        throw e;
      }
      await this.deps.authHandler.runAuthFlow(agentName, agentId, connInfo);
      try {
        sessionResponse = await connInfo.connection.newSession({
          cwd,
          mcpServers: [],
        });
      } catch (retryErr) {
        logError('Failed to create session after authentication', retryErr);
        this.deps.agentManager.killAgent(agentId);
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
    this.deps.sessionState.addSession(sessionInfo);
    this.deps.updateBuffer.drainInto(sessionInfo);

    this.deps.discussionContextHandler.getHistoryStore()?.upsertNew(
      agentName,
      workspace,
      sessionInfo.sessionId,
      agentFingerprint,
    );

    return sessionInfo;
  }

  async ensureConnected(agentName: string): Promise<ConnectionInfo> {
    const existingSessionId = this.deps.sessionState.getAgentSession(agentName);
    if (existingSessionId) {
      const existing = this.deps.sessionState.getSession(existingSessionId);
      if (existing) {
        const conn = this.deps.connectionManager.getConnection(existing.agentId);
        if (conn) {
          const caps = this.deps.sessionState.summarizeCapabilities(conn.initResponse.agentCapabilities);
          this.deps.sessionState.setCapabilities(agentName, caps);
          return conn;
        }
      }
    }

    for (const instance of this.deps.agentManager.getRunningAgents()) {
      if (instance.name === agentName) {
        const conn = this.deps.connectionManager.getConnection(instance.id);
        if (conn) {
          const caps = this.deps.sessionState.summarizeCapabilities(conn.initResponse.agentCapabilities);
          this.deps.sessionState.setCapabilities(agentName, caps);
          return conn;
        }
      }
    }

    const configs = this.deps.getConfigs();
    const config = configs[agentName];
    if (!config) {
      this.deps.discussionContextHandler.getHistoryStore()?.markAgentStatus(agentName, 'agentRemoved');
      throw new Error(`Unknown agent: ${agentName}.`);
    }

    const workspaceCwd = this.deps.getWorkspaceCwd();
    const agentInstance = this.deps.agentManager.spawnAgent(agentName, config, workspaceCwd);
    const agentId = agentInstance.id;

    const agentProcess = this.deps.agentManager.getAgent(agentId);
    if (!agentProcess) {
      throw new Error('Agent process not found after spawn');
    }

    let connInfo: ConnectionInfo;
    try {
      connInfo = await this.deps.connectionManager.connect(
        agentId,
        agentProcess.process,
        workspaceCwd,
        { autoApproveAll: isSandcastleAgentConfig(config) },
      );
    } catch (e) {
      this.deps.agentManager.killAgent(agentId);
      this.recordAgentConnectionFailure(agentName, e);
      throw e;
    }

    const caps = this.deps.sessionState.summarizeCapabilities(connInfo.initResponse.agentCapabilities);
    this.deps.sessionState.setCapabilities(agentName, caps);
    return connInfo;
  }

  findAgentIdForConnection(conn: ConnectionInfo): string | undefined {
    for (const session of this.deps.sessionState.getAllSessions().values()) {
      const c = this.deps.connectionManager.getConnection(session.agentId);
      if (c === conn) { return session.agentId; }
    }
    for (const instance of this.deps.agentManager.getRunningAgents()) {
      if (this.deps.connectionManager.getConnection(instance.id) === conn) {
        return instance.id;
      }
    }
    return undefined;
  }

  recordAgentConnectionFailure(agentName: string, error: unknown): void {
    const classified = classifyAgentError(error);
    if (classified.kind === 'missing-pipeline-agent') {
      this.deps.discussionContextHandler.getHistoryStore()?.markAgentStatus(agentName, 'agentRemoved');
    } else if (classified.kind !== 'auth-cancelled') {
      this.deps.discussionContextHandler.getHistoryStore()?.markAgentStatus(agentName, 'agentUnavailable');
    }
    this.deps.emit('agent-error', agentName, error);
  }
}
