import { EventEmitter } from 'node:events';

import type {
  NewSessionResponse,
  PromptResponse,
  InitializeResponse,
  ContentBlock,
  SessionModeState,
  SessionModelState,
  AvailableCommand,
  SessionConfigOption,
  SessionInfo as ProtocolSessionInfo,
  SessionNotification,
} from '@agentclientprotocol/sdk';
import { PROTOCOL_VERSION } from '@agentclientprotocol/sdk';

import { AgentManager } from './AgentManager';
import { ConnectionManager, ConnectionInfo } from './ConnectionManager';
import { ContextFamilyInfo, SessionHistoryStore } from './SessionHistoryStore';
import { classifyAgentError } from './AgentError';
import { resolveWorkspaceIdentity, type WorkspaceIdentity } from './WorkspaceIdentity';
import { getAgentConfigs, isSandcastleAgentConfig } from '../config/AgentConfig';
import { SessionState } from './SessionState';
import { SessionUpdateBuffer } from './SessionUpdateBuffer';
import { SessionAuthHandler } from './SessionAuthHandler';
import { DiscussionContextHandler } from './DiscussionContextHandler';
import { log, logError } from '../utils/Logger';
import { sendEvent, sendError } from '../utils/TelemetryManager';
import type { VirtualSessionRuntime } from './VirtualSessionRuntime';
import { SkillsCatalog } from '../skills/SkillsCatalog';
import { isSkillsEnabledAgent, isCursorCliAgent } from '../skills/SkillsConfig';
import { buildPromptWithSkills } from '../skills/SkillsPromptBuilder';
import { prepareCursorSkillsSymlink } from '../skills/SkillsWorkspacePrep';

export type { AgentCapabilitySummary } from './SessionState';
export type { SharedDiscussionContext } from './DiscussionContextHandler';

export interface SessionInfo {
  sessionId: string;
  agentId: string;
  agentName: string;
  agentDisplayName: string;
  cwd: string;
  createdAt: string;
  initResponse: InitializeResponse;
  modes: SessionModeState | null;
  models: SessionModelState | null;
  /**
   * Generic session config options (ACP "Session Config Options" — supersedes
   * `modes` / `models`). `null` means the agent did not provide this field.
   * Per spec, when both `configOptions` and `modes` are present, clients
   * should use `configOptions` exclusively.
   */
  configOptions: SessionConfigOption[] | null;
  availableCommands: AvailableCommand[];
  /** Latest title supplied via `session_info_update`, if any. */
  title?: string;
  /** Identifies sessions whose conversation lifecycle is owned by a plugin. */
  transport?: 'acp' | 'virtual';
  /** Whether the skills catalog was injected for this session. */
  skillsBootstrapped?: boolean;
}

export interface OpenSessionOptions {
  shareCurrentContext?: boolean;
}

export interface OpenedSession {
  session: SessionInfo;
  historyReplayed: boolean;
}

/**
 * Manages the lifecycle of ACP agent connections.
 *
 * The "session" concept is hidden from the user — they just see agents.
 * Internally we still use ACP sessions for protocol compliance, but the
 * user-facing model is: pick an agent → chat.
 */
export class SessionManager extends EventEmitter {
  private readonly sessionState: SessionState;
  private readonly updateBuffer: SessionUpdateBuffer;
  private readonly authHandler: SessionAuthHandler;
  private readonly discussionContextHandler: DiscussionContextHandler;
  private virtualSessionRuntime: VirtualSessionRuntime | null = null;

  private testConfigs: Record<string, any> | null = null;

  constructor(
    private readonly agentManager: AgentManager,
    private readonly connectionManager: ConnectionManager,
    private readonly workspaceIdentityProvider: () => WorkspaceIdentity = resolveWorkspaceIdentity,
  ) {
    super();
    this.sessionState = new SessionState();
    this.updateBuffer = new SessionUpdateBuffer();
    this.authHandler = new SessionAuthHandler(agentManager);
    this.discussionContextHandler = new DiscussionContextHandler(null);
  }

  /** Wire in the persistent session-history store (called once at startup). */
  setHistoryStore(store: SessionHistoryStore): void {
    this.discussionContextHandler.setHistoryStore(store);
  }

  registerVirtualSessionRuntime(runtime: VirtualSessionRuntime): { dispose(): void } {
    if (this.virtualSessionRuntime) {
      throw new Error('A virtual session runtime is already registered.');
    }
    this.virtualSessionRuntime = runtime;
    let disposed = false;
    return {
      dispose: () => {
        if (disposed) { return; }
        disposed = true;
        if (this.virtualSessionRuntime === runtime) {
          this.virtualSessionRuntime = null;
        }
      },
    };
  }

  /** Public accessor for downstream UI. */
  getHistoryStore(): SessionHistoryStore | null {
    return this.discussionContextHandler.getHistoryStore();
  }

  /** Return true when the active session has discussion context worth sharing to the target. */
  hasShareableDiscussionContext(targetAgentName: string, targetSessionId?: string): boolean {
    return this.discussionContextHandler.hasShareableDiscussionContext(
      targetAgentName,
      this.sessionState.getActiveSession(),
      targetSessionId,
    );
  }

  /** Return context-family metadata for a live session, if available. */
  getSessionContextFamily(sessionId: string): ContextFamilyInfo | null {
    return this.discussionContextHandler.getSessionContextFamily(
      this.sessionState.getSession(sessionId),
      sessionId,
    );
  }

  /** Return the active session's context-family id, used by the tree view. */
  getActiveContextFamilyId(): string | null {
    return this.discussionContextHandler.getActiveContextFamilyId(
      this.sessionState.getActiveSession(),
      this.sessionState.getActiveSessionId(),
    );
  }

  /**
   * Read cached capabilities for an agent. Returns `undefined` if the agent
   * has never been initialized — callers can call {@link ensureConnected}
   * first to populate.
   */
  getCachedCapabilities(agentName: string): import('./SessionState').AgentCapabilitySummary | undefined {
    return this.sessionState.getCachedCapabilities(agentName);
  }

  /** @internal Used for testing to inject agent configurations. */
  setTestConfigs(configs: Record<string, any>): void {
    this.testConfigs = configs;
  }

  private getConfigs(): Record<string, any> {
    return this.testConfigs || getAgentConfigs();
  }

  private getWorkspaceIdentity(): WorkspaceIdentity {
    return this.workspaceIdentityProvider();
  }

  private getWorkspaceCwd(): string {
    return this.getWorkspaceIdentity().cwd;
  }

  /**
   * Connect to an agent and start chatting.
   * Only one agent can be connected at a time — automatically disconnects
   * any previously connected agent.
   * Internally creates a session via ACP protocol.
   */
  async connectToAgent(agentName: string, options: OpenSessionOptions = {}): Promise<SessionInfo> {
    if (this.virtualSessionRuntime?.canHandle(agentName)) {
      return this.connectToVirtualAgent(agentName, options);
    }

    // If we already have a live session with this agent, reuse it
    const existingSessionId = this.sessionState.getAgentSession(agentName);
    if (existingSessionId && this.sessionState.getSession(existingSessionId)) {
      this.sessionState.setActiveSessionId(existingSessionId);
      this.emit('active-session-changed', existingSessionId);
      return this.sessionState.getSession(existingSessionId)!;
    }

    // Disconnect any currently connected agent first (single-agent model)
    const currentAgent = this.sessionState.getActiveAgentName();
    const sharedDiscussionContext = options.shareCurrentContext && currentAgent !== agentName
      ? this.discussionContextHandler.buildSharedDiscussionContextForTarget(
          agentName,
          this.sessionState.getActiveSession(),
          undefined,
        )
      : null;

    if (currentAgent) {
      await this.disconnectAgent(currentAgent);
    }

    const configs = this.getConfigs();
    const config = configs[agentName];
    if (!config) {
      throw new Error(`Unknown agent: ${agentName}. Available: ${Object.keys(configs).join(', ')}`);
    }

    log(`SessionManager: connecting to agent "${agentName}"`);
    sendEvent('agent/connect.start', { agentName });
    const connectStartTime = Date.now();

    try {
      const workspace = this.getWorkspaceIdentity();
      const workspaceCwd = workspace.cwd;

      this.prepareSkillsForAgent(agentName, workspaceCwd);

      // Spawn the agent process in workspace cwd
      const agentInstance = this.agentManager.spawnAgent(agentName, config, workspaceCwd);
      const agentId = agentInstance.id;

      // Listen for agent errors/close
      this.agentManager.on('agent-error', (evt: { agentId: string; error: Error }) => {
        if (evt.agentId === agentId) {
          logError(`Agent ${agentName} error`, evt.error);
          this.emit('agent-error', agentId, evt.error);
        }
      });

      this.agentManager.on('agent-closed', (evt: { agentId: string; code: number | null }) => {
        if (evt.agentId === agentId) {
          log(`Agent ${agentName} closed with code ${evt.code}`);
          // Clean up the session for this agent
          const sessionId = this.sessionState.getAgentSession(agentName);
          if (sessionId) {
            this.sessionState.deleteSession(sessionId);
            this.sessionState.deleteAgentSession(agentName);
            if (this.sessionState.getActiveSessionId() === sessionId) {
              this.sessionState.setActiveSessionId(null);
            }
            this.emit('agent-disconnected', agentName);
            this.emit('active-session-changed', null);
          }
          this.emit('agent-closed', agentId, evt.code);
        }
      });

      // Connect and initialize
      const agentProcess = this.agentManager.getAgent(agentId);
      if (!agentProcess) {
        throw new Error('Agent process not found after spawn');
      }

      let connInfo: ConnectionInfo;
      try {
        connInfo = await this.connectionManager.connect(
          agentId,
          agentProcess.process,
          workspaceCwd,
          { autoApproveAll: isSandcastleAgentConfig(config) },
        );
      } catch (e) {
        this.agentManager.killAgent(agentId);
        throw e;
      }

      // Create ACP session (with auth handling). The session is already
      // registered in `this.sessionState` by createAcpSession so that any
      // notifications arriving during/after newSession can be persisted.
      const sessionInfo = await this.createAcpSession(
        agentName,
        agentId,
        connInfo,
        workspace,
        this.fingerprintAgentConfig(config),
      );

      if (sharedDiscussionContext) {
        this.discussionContextHandler.setPending(sessionInfo.sessionId, sharedDiscussionContext.text);
        this.discussionContextHandler.linkContextFamily(
          sharedDiscussionContext,
          agentName,
          sessionInfo.sessionId,
          workspace,
        );
        this.emit('pending-shared-context-changed', sessionInfo.sessionId);
      }

      this.sessionState.setAgentSession(agentName, sessionInfo.sessionId);
      this.sessionState.setActiveSessionId(sessionInfo.sessionId);

      this.emit('agent-connected', agentName);
      this.emit('active-session-changed', sessionInfo.sessionId);

      log(`Connected to agent ${agentName}, session ${sessionInfo.sessionId}`);
      sendEvent('agent/connect.end', { agentName, result: 'success' }, { duration: Date.now() - connectStartTime });
      return sessionInfo;
    } catch (e: any) {
      this.recordAgentConnectionFailure(agentName, e);
      sendError('agent/connect.end', { agentName, result: 'error', errorMessage: e.message || String(e) }, { duration: Date.now() - connectStartTime });
      throw e;
    }
  }

  private async connectToVirtualAgent(agentName: string, options: OpenSessionOptions = {}): Promise<SessionInfo> {
    const runtime = this.virtualSessionRuntime;
    if (!runtime) {
      throw new Error('Virtual session runtime is not available.');
    }
    const existingSessionId = this.sessionState.getAgentSession(agentName);
    if (existingSessionId && this.sessionState.getSession(existingSessionId)) {
      this.sessionState.setActiveSessionId(existingSessionId);
      this.emit('active-session-changed', existingSessionId);
      return this.sessionState.getSession(existingSessionId)!;
    }

    const currentAgent = this.sessionState.getActiveAgentName();
    const sharedDiscussionContext = options.shareCurrentContext && currentAgent !== agentName
      ? this.discussionContextHandler.buildSharedDiscussionContextForTarget(
          agentName,
          this.sessionState.getActiveSession(),
          undefined,
        )
      : null;

    if (currentAgent) {
      await this.disconnectAgent(currentAgent);
    }

    const cwd = this.getWorkspaceCwd();
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

    this.sessionState.addSession(sessionInfo);
    this.discussionContextHandler.getHistoryStore()?.upsertNew(
      agentName,
      cwd,
      sessionId,
    );
    if (sharedDiscussionContext) {
      this.discussionContextHandler.setPending(sessionId, sharedDiscussionContext.text);
      this.discussionContextHandler.linkContextFamily(
        sharedDiscussionContext,
        agentName,
        sessionId,
        cwd,
      );
      this.emit('pending-shared-context-changed', sessionId);
    }
    this.sessionState.setAgentSession(agentName, sessionId);
    this.sessionState.setActiveSessionId(sessionId);
    this.emit('agent-connected', agentName);
    this.emit('active-session-changed', sessionId);
    return sessionInfo;
  }

  /**
   * Start a new conversation with the currently connected agent.
   * Disconnects current session, reconnects, and signals chat to clear.
   */
  async newConversation(): Promise<SessionInfo | null> {
    const activeSession = this.sessionState.getActiveSession();
    if (!activeSession) {
      return null;
    }

    const agentName = activeSession.agentName;
    await this.disconnectAgent(agentName);
    this.emit('clear-chat');
    return this.connectToAgent(agentName);
  }

  /**
   * Disconnect from an agent: kill process and clean up.
   */
  async disconnectAgent(agentName: string): Promise<void> {
    const sessionId = this.sessionState.getAgentSession(agentName);
    if (!sessionId) { return; }

    const session = this.sessionState.getSession(sessionId);
    if (!session) { return; }

    log(`Disconnecting agent ${agentName}`);
    sendEvent('agent/disconnect', { agentName });

    if (session.transport === 'virtual') {
      this.virtualSessionRuntime?.cancel(session.sessionId);
    } else {
      this.agentManager.killAgent(session.agentId);
      this.connectionManager.removeConnection(session.agentId);
    }
    this.sessionState.deleteSession(sessionId);
    this.sessionState.deleteAgentSession(agentName);

    if (this.sessionState.getActiveSessionId() === sessionId) {
      this.sessionState.setActiveSessionId(null);
    }

    this.emit('agent-disconnected', agentName);
    this.emit('active-session-changed', null);
  }

  /**
   * Internal: create the ACP session with auth handling.
   */
  private async createAcpSession(
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
      if (!this.authHandler.isAuthRequiredError(e)) {
        logError('Failed to create session', e);
        this.agentManager.killAgent(agentId);
        throw e;
      }
      // Auth required — interactively authenticate, then retry.
      await this.authHandler.runAuthFlow(agentName, agentId, connInfo);
      try {
        sessionResponse = await connInfo.connection.newSession({
          cwd,
          mcpServers: [],
        });
      } catch (retryErr) {
        logError('Failed to create session after authentication', retryErr);
        this.agentManager.killAgent(agentId);
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
    // resolution so that any session/update notifications dispatched by the
    // agent (e.g. available_commands_update) can be persisted onto it.
    this.sessionState.addSession(sessionInfo);
    this.updateBuffer.drainInto(sessionInfo);

    // Capture in the local history store so it appears in the tree.
    this.discussionContextHandler.getHistoryStore()?.upsertNew(
      agentName,
      workspace,
      sessionInfo.sessionId,
      agentFingerprint,
    );

    return sessionInfo;
  }

  /** Returns true if a thrown error denotes ACP "auth required" (-32000). */
  private isAuthRequiredError(e: any): boolean {
    return this.authHandler.isAuthRequiredError(e);
  }

  private fingerprintAgentConfig(config: unknown): string | undefined {
    try {
      return JSON.stringify(config);
    } catch {
      return undefined;
    }
  }

  private prepareSkillsForAgent(agentName: string, workspaceCwd: string): void {
    if (!isSkillsEnabledAgent(agentName)) {
      return;
    }

    if (isCursorCliAgent(agentName)) {
      prepareCursorSkillsSymlink(workspaceCwd);
    }

    const catalog = new SkillsCatalog(workspaceCwd);
    const skills = catalog.listSkills();
    log(`Skills: discovered ${skills.length} skill(s) for agent "${agentName}"`);
  }

  // --- Session Updates ---

  /**
   * Replace a session's configOptions in place and notify listeners.
   * Used by both the setter response and the `config_option_update`
   * push-notification handler.
   */
  applyConfigOptions(sessionId: string, options: SessionConfigOption[] | null): void {
    const session = this.sessionState.getSession(sessionId);
    if (!session) {
      // Buffer until the session is registered
      this.updateBuffer.bufferConfigOptions(sessionId, options ?? []);
      return;
    }
    session.configOptions = options ?? null;
    this.emit('config-options-changed', sessionId, session.configOptions);
  }

  /**
   * Replace a session's availableCommands and notify listeners. Buffers
   * the value if the session isn't registered yet (race during creation).
   */
  applyAvailableCommands(sessionId: string, commands: AvailableCommand[]): void {
    const session = this.sessionState.getSession(sessionId);
    if (!session) {
      this.updateBuffer.bufferAvailableCommands(sessionId, commands);
      return;
    }
    session.availableCommands = commands;
    this.emit('available-commands-changed', sessionId, commands);
  }

  /**
   * Apply a `session_info_update` notification: patches title / updatedAt on
   * the in-memory session and on the persistent history store.
   */
  applySessionInfoUpdate(sessionId: string, update: { title?: string | null; updatedAt?: string | null }): void {
    const session = this.sessionState.getSession(sessionId);
    if (session) {
      if (update.title === null) {
        delete session.title;
      } else if (typeof update.title === 'string') {
        session.title = update.title;
      }
    } else if (typeof update.title === 'string') {
      // Session not registered yet — buffer for drain.
      this.updateBuffer.bufferTitle(sessionId, update.title);
    }
    // Mirror onto the history store regardless of whether session is live.
    const storedSession = this.sessionState.getSession(sessionId);
    if (this.discussionContextHandler.getHistoryStore() && storedSession) {
      this.discussionContextHandler.getHistoryStore()!.setTitle(
        storedSession.agentName,
        sessionId,
        update.title,
      );
    }
    this.emit('session-info-changed', sessionId, update);
  }

  /** Persist a user message and establish the history label atomically. */
  recordUserMessage(sessionId: string, text: string): void {
    const session = this.sessionState.getSession(sessionId);
    this.discussionContextHandler.recordFirstPrompt(session, sessionId, text);
    this.discussionContextHandler.recordUserMessage(
      session,
      sessionId,
      text,
    );
  }

  /** Persist a replayed user-message chunk in the discussion transcript. */
  recordUserMessageChunk(sessionId: string, text: string): void {
    this.discussionContextHandler.recordUserMessageChunk(
      this.sessionState.getSession(sessionId),
      sessionId,
      text,
    );
  }

  /** Persist an assistant-message chunk in the discussion transcript. */
  recordAssistantMessageChunk(sessionId: string, text: string): void {
    this.discussionContextHandler.recordAssistantMessageChunk(
      this.sessionState.getSession(sessionId),
      sessionId,
      text,
    );
  }

  /**
   * Persist Discussion chunks from an ACP session/update notification.
   * Single entry for native, sandcastle, and virtual orchestration projections.
   */
  ingestSessionUpdate(sessionId: string, notification: SessionNotification): void {
    const update = notification.update as any;
    const text = textFromSessionUpdate(update);
    if (update?.sessionUpdate === 'agent_message_chunk' && text) {
      this.recordAssistantMessageChunk(sessionId, text);
    }
    if (update?.sessionUpdate === 'user_message_chunk' && text && this.isLoading(sessionId)) {
      this.recordUserMessageChunk(sessionId, text);
    }
  }

  /** Bump a session's `lastActiveAt` in the history store. */
  touchHistory(sessionId: string): void {
    this.discussionContextHandler.touchHistory(
      this.sessionState.getSession(sessionId),
      sessionId,
    );
  }

  // --- Connection lifecycle (no session) ---

  /**
   * Spawn + initialize + (optionally authenticate) an agent without creating
   * a session. Caches the capability summary. Idempotent.
   *
   * NOTE: this never disconnects the currently-active agent — it is safe to
   * call from the tree view to probe capabilities or list sessions while
   * the user is chatting with a different agent. Callers that want to
   * switch the active session (e.g. loadSession) handle the active-agent
   * teardown themselves.
   */
  async ensureConnected(agentName: string): Promise<ConnectionInfo> {
    // If we already have a live session with this agent, reuse its connection.
    const existingSessionId = this.sessionState.getAgentSession(agentName);
    if (existingSessionId) {
      const existing = this.sessionState.getSession(existingSessionId);
      if (existing) {
        const conn = this.connectionManager.getConnection(existing.agentId);
        if (conn) {
          const caps = this.sessionState.summarizeCapabilities(conn.initResponse.agentCapabilities);
          this.sessionState.setCapabilities(agentName, caps);
          return conn;
        }
      }
    }

    // If the agent process is already spawned (e.g. from a previous probe),
    // reuse it instead of spawning a new one.
    for (const instance of this.agentManager.getRunningAgents()) {
      if (instance.name === agentName) {
        const conn = this.connectionManager.getConnection(instance.id);
        if (conn) {
          const caps = this.sessionState.summarizeCapabilities(conn.initResponse.agentCapabilities);
          this.sessionState.setCapabilities(agentName, caps);
          return conn;
        }
      }
    }

    const configs = this.getConfigs();
    const config = configs[agentName];
    if (!config) {
      this.discussionContextHandler.getHistoryStore()?.markAgentStatus(agentName, 'agentRemoved');
      throw new Error(`Unknown agent: ${agentName}.`);
    }

    const workspaceCwd = this.getWorkspaceCwd();
    const agentInstance = this.agentManager.spawnAgent(agentName, config, workspaceCwd);
    const agentId = agentInstance.id;

    const agentProcess = this.agentManager.getAgent(agentId);
    if (!agentProcess) {
      throw new Error('Agent process not found after spawn');
    }

    let connInfo: ConnectionInfo;
    try {
      connInfo = await this.connectionManager.connect(
        agentId,
        agentProcess.process,
        workspaceCwd,
        { autoApproveAll: isSandcastleAgentConfig(config) },
      );
    } catch (e) {
      this.agentManager.killAgent(agentId);
      this.recordAgentConnectionFailure(agentName, e);
      throw e;
    }

    const caps = this.sessionState.summarizeCapabilities(connInfo.initResponse.agentCapabilities);
    this.sessionState.setCapabilities(agentName, caps);
    return connInfo;
  }

  /**
   * List sessions known to an agent (ACP `session/list`).
   * Throws if the agent doesn't advertise the capability.
   */
  async listSessions(agentName: string, opts: { cwd?: string; cursor?: string } = {}): Promise<{ sessions: ProtocolSessionInfo[]; nextCursor?: string }> {
    const conn = await this.ensureConnected(agentName);
    const caps = this.sessionState.getCachedCapabilities(agentName);
    if (!caps?.list) {
      throw new Error(`Agent "${agentName}" does not support session/list.`);
    }

    const params: any = {};
    if (opts.cwd) { params.cwd = opts.cwd; }
    if (opts.cursor) { params.cursor = opts.cursor; }

    let response: any;
    try {
      response = await conn.connection.listSessions(params);
    } catch (e: any) {
      if (this.authHandler.isAuthRequiredError(e)) {
        // Auth then retry.
        const agentInfo = this.findAgentIdForConnection(conn);
        if (agentInfo) {
          await this.authHandler.runAuthFlow(agentName, agentInfo, conn);
          response = await conn.connection.listSessions(params);
        } else {
          throw e;
        }
      } else {
        throw e;
      }
    }

    const sessions: ProtocolSessionInfo[] = response?.sessions ?? [];
    // Reconcile the history store without deleting missing sessions silently.
    if (this.discussionContextHandler.getHistoryStore() && !opts.cursor) {
      this.discussionContextHandler.getHistoryStore()!.reconcileFromAgent(
        agentName,
        new Set(sessions.map(s => s.sessionId)),
        opts.cwd,
      );
    }
    return { sessions, nextCursor: response?.nextCursor ?? undefined };
  }

  /**
   * Open an existing conversation through the best capability advertised by
   * the agent. Callers do not need to coordinate capability discovery with
   * load/resume ordering.
   */
  async openSession(
    agentName: string,
    sessionId: string,
    options: OpenSessionOptions = {},
  ): Promise<OpenedSession> {
    await this.ensureConnected(agentName);
    const capabilities = this.sessionState.getCachedCapabilities(agentName);
    if (capabilities?.load) {
      return {
        session: await this.loadSession(agentName, sessionId, options),
        historyReplayed: true,
      };
    }
    if (capabilities?.resume) {
      return {
        session: await this.resumeSession(agentName, sessionId, options),
        historyReplayed: false,
      };
    }
    throw new Error(`Agent "${agentName}" does not support loading or resuming sessions.`);
  }

  /**
   * Load an existing session, replaying the entire conversation history via
   * `session/update` notifications. Heavyweight. Active session is switched
   * to the loaded session on success.
   */
  async loadSession(agentName: string, sessionId: string, options: OpenSessionOptions = {}): Promise<SessionInfo> {
    // Capture before disconnecting or replacing the active session
    const sharedDiscussionContext = options.shareCurrentContext
      ? this.discussionContextHandler.buildSharedDiscussionContextForTarget(
          agentName,
          this.sessionState.getActiveSession(),
          sessionId,
        )
      : null;

    // Honor the single-active-session model
    const currentAgent = this.sessionState.getActiveAgentName();
    if (currentAgent && currentAgent !== agentName) {
      await this.disconnectAgent(currentAgent);
    }

    const conn = await this.ensureConnected(agentName);
    const caps = this.sessionState.getCachedCapabilities(agentName);
    if (!caps?.load) {
      throw new Error(`Agent "${agentName}" does not support session/load.`);
    }

    // If the same agent has a different active session, clear it
    const previouslyActive = this.sessionState.getActiveSessionId();
    if (previouslyActive && previouslyActive !== sessionId) {
      const prevSession = this.sessionState.getSession(previouslyActive);
      if (prevSession) {
        this.sessionState.deleteAgentSession(prevSession.agentName);
      }
      this.sessionState.deleteSession(previouslyActive);
      this.sessionState.setActiveSessionId(null);
    }

    const cwd = this.getWorkspaceCwd();
    const agentId = this.findAgentIdForConnection(conn);
    if (!agentId) {
      throw new Error(`Unable to locate agent process for "${agentName}".`);
    }
    this.discussionContextHandler.getHistoryStore()?.upsertNew(agentName, cwd, sessionId);

    // Pre-register a placeholder so notifications during replay can be associated
    const placeholder: SessionInfo = {
      sessionId,
      agentId,
      agentName,
      agentDisplayName: conn.initResponse.agentInfo?.title
        || conn.initResponse.agentInfo?.name
        || agentName,
      cwd,
      createdAt: new Date().toISOString(),
      initResponse: conn.initResponse,
      modes: null,
      models: null,
      configOptions: null,
      availableCommands: [],
    };
    this.sessionState.addSession(placeholder);
    this.updateBuffer.drainInto(placeholder);
    this.sessionState.markLoading(sessionId);
    this.discussionContextHandler.getHistoryStore()?.clearDiscussion(agentName, sessionId);

    this.sessionState.setAgentSession(agentName, sessionId);
    this.sessionState.setActiveSessionId(sessionId);

    this.emit('agent-connected', agentName);
    this.emit('active-session-changed', sessionId);
    this.emit('session-load-start', sessionId, agentName);

    try {
      const response = await conn.connection.loadSession({
        sessionId,
        cwd,
        mcpServers: [],
      });
      placeholder.modes = (response as any).modes ?? null;
      placeholder.models = (response as any).models ?? null;
      placeholder.configOptions = (response as any).configOptions ?? null;
    } catch (e: any) {
      this.sessionState.unmarkLoading(sessionId);
      this.sessionState.deleteSession(sessionId);
      this.sessionState.deleteAgentSession(agentName);
      if (this.sessionState.getActiveSessionId() === sessionId) {
        this.sessionState.setActiveSessionId(null);
      }
      this.emit('session-load-end', sessionId, agentName, false);
      this.emit('active-session-changed', null);

      const msg = String(e?.message || '');
      if (/not found|no such|unknown session/i.test(msg)) {
        this.discussionContextHandler.getHistoryStore()?.markStatus(agentName, sessionId, 'missing');
      }
      throw e;
    }

    this.sessionState.unmarkLoading(sessionId);
    if (sharedDiscussionContext) {
      this.discussionContextHandler.setPending(sessionId, sharedDiscussionContext.text);
      this.discussionContextHandler.linkContextFamily(
        sharedDiscussionContext,
        agentName,
        sessionId,
        cwd,
      );
      this.emit('pending-shared-context-changed', sessionId);
    }
    this.emit('session-load-end', sessionId, agentName, true);

    this.discussionContextHandler.touchHistory(
      this.sessionState.getSession(sessionId),
      sessionId,
    );
    return placeholder;
  }

  /**
   * Resume an existing session without replaying history (light path).
   */
  async resumeSession(agentName: string, sessionId: string, options: OpenSessionOptions = {}): Promise<SessionInfo> {
    const sharedDiscussionContext = options.shareCurrentContext
      ? this.discussionContextHandler.buildSharedDiscussionContextForTarget(
          agentName,
          this.sessionState.getActiveSession(),
          sessionId,
        )
      : null;

    const currentAgent = this.sessionState.getActiveAgentName();
    if (currentAgent && currentAgent !== agentName) {
      await this.disconnectAgent(currentAgent);
    }

    const conn = await this.ensureConnected(agentName);
    const caps = this.sessionState.getCachedCapabilities(agentName);
    if (!caps?.resume) {
      throw new Error(`Agent "${agentName}" does not support session/resume.`);
    }

    // If the same agent has a different active session, clear it.
    const previouslyActive = this.sessionState.getActiveSessionId();
    if (previouslyActive && previouslyActive !== sessionId) {
      const prevSession = this.sessionState.getSession(previouslyActive);
      if (prevSession) {
        this.sessionState.deleteAgentSession(prevSession.agentName);
      }
      this.sessionState.deleteSession(previouslyActive);
      this.sessionState.setActiveSessionId(null);
    }

    const cwd = this.getWorkspaceCwd();
    const agentId = this.findAgentIdForConnection(conn);
    if (!agentId) {
      throw new Error(`Unable to locate agent process for "${agentName}".`);
    }

    let response: any;
    try {
      response = await conn.connection.resumeSession({
        sessionId,
        cwd,
        mcpServers: [],
      });
    } catch (e: any) {
      const msg = String(e?.message || '');
      if (/not found|no such|unknown session/i.test(msg)) {
        this.discussionContextHandler.getHistoryStore()?.markStatus(agentName, sessionId, 'missing');
      }
      throw e;
    }

    const sessionInfo: SessionInfo = {
      sessionId,
      agentId,
      agentName,
      agentDisplayName: conn.initResponse.agentInfo?.title
        || conn.initResponse.agentInfo?.name
        || agentName,
      cwd,
      createdAt: new Date().toISOString(),
      initResponse: conn.initResponse,
      modes: response?.modes ?? null,
      models: response?.models ?? null,
      configOptions: response?.configOptions ?? null,
      availableCommands: [],
    };
    this.sessionState.addSession(sessionInfo);
    if (sharedDiscussionContext) {
      this.discussionContextHandler.setPending(sessionId, sharedDiscussionContext.text);
      this.discussionContextHandler.linkContextFamily(
        sharedDiscussionContext,
        agentName,
        sessionId,
        cwd,
      );
      this.emit('pending-shared-context-changed', sessionId);
    }
    this.updateBuffer.drainInto(sessionInfo);
    this.sessionState.setAgentSession(agentName, sessionId);
    this.sessionState.setActiveSessionId(sessionId);
    this.emit('agent-connected', agentName);
    this.emit('active-session-changed', sessionId);

    this.discussionContextHandler.touchHistory(
      this.sessionState.getSession(sessionId),
      sessionId,
    );
    return sessionInfo;
  }

  isLoading(sessionId: string): boolean {
    return this.sessionState.isLoading(sessionId);
  }

  hasPendingSharedDiscussionContext(sessionId: string): boolean {
    return this.discussionContextHandler.hasPending(sessionId);
  }

  /** Helper: reverse-lookup agentId for a known ConnectionInfo. */
  private findAgentIdForConnection(conn: ConnectionInfo): string | undefined {
    for (const session of this.sessionState.getAllSessions().values()) {
      const c = this.connectionManager.getConnection(session.agentId);
      if (c === conn) { return session.agentId; }
    }
    for (const instance of this.agentManager.getRunningAgents()) {
      if (this.connectionManager.getConnection(instance.id) === conn) {
        return instance.id;
      }
    }
    return undefined;
  }

  // --- Getters ---

  getSession(sessionId: string): SessionInfo | undefined {
    return this.sessionState.getSession(sessionId);
  }

  getActiveSession(): SessionInfo | undefined {
    return this.sessionState.getActiveSession();
  }

  getActiveSessionId(): string | null {
    return this.sessionState.getActiveSessionId();
  }

  /** Get the agent name for the current active session. */
  getActiveAgentName(): string | null {
    return this.sessionState.getActiveAgentName();
  }

  /** Check if a specific agent is currently connected. */
  isAgentConnected(agentName: string): boolean {
    return this.sessionState.isAgentConnected(agentName);
  }

  /** Get all connected agent names. */
  getConnectedAgentNames(): string[] {
    return this.sessionState.getConnectedAgentNames();
  }

  getConnectionForSession(sessionId: string): ConnectionInfo | undefined {
    const session = this.sessionState.getSession(sessionId);
    if (!session) { return undefined; }
    return this.connectionManager.getConnection(session.agentId);
  }

  isVirtualSession(sessionId: string | null | undefined): boolean {
    if (!sessionId) { return false; }
    return this.sessionState.getSession(sessionId)?.transport === 'virtual';
  }

  private recordAgentConnectionFailure(agentName: string, error: unknown): void {
    const classified = classifyAgentError(error);
    if (classified.kind === 'missing-pipeline-agent') {
      this.discussionContextHandler.getHistoryStore()?.markAgentStatus(agentName, 'agentRemoved');
    } else if (classified.kind !== 'auth-cancelled') {
      this.discussionContextHandler.getHistoryStore()?.markAgentStatus(agentName, 'agentUnavailable');
    }
    this.emit('agent-error', agentName, error);
  }

  // --- Prompt & Config ---

  /**
   * Send a prompt to the active session.
   */
  async sendPrompt(sessionId: string, text: string): Promise<PromptResponse> {
    const textWithSharedContext = this.discussionContextHandler.consumePending(sessionId, text);
    const session = this.sessionState.getSession(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    if (session.transport === 'virtual') {
      if (!this.virtualSessionRuntime) {
        throw new Error('Virtual session runtime is not available.');
      }
      return this.virtualSessionRuntime.sendPrompt(sessionId, textWithSharedContext, session.agentName);
    }

    const connInfo = this.connectionManager.getConnection(session.agentId);
    if (!connInfo) {
      throw new Error(`No connection for agent: ${session.agentId}`);
    }

    log(`sendPrompt: session=${sessionId}, textLength=${text.length}`);

    const skillsResult = buildPromptWithSkills({
      agentName: session.agentName,
      workspaceCwd: session.cwd,
      text: textWithSharedContext,
      skillsBootstrapped: session.skillsBootstrapped === true,
    });
    if (skillsResult.skillsBootstrapped && !session.skillsBootstrapped) {
      session.skillsBootstrapped = true;
      this.sessionState.addSession(session);
    }

    const prompt: ContentBlock[] = [
      { type: 'text', text: skillsResult.text },
    ];

    const response = await connInfo.connection.prompt({
      sessionId,
      prompt,
    });

    log(`Prompt response: stopReason=${response.stopReason}`);
    return response;
  }

  /**
   * Cancel an active prompt turn.
   */
  async cancelTurn(sessionId: string): Promise<void> {
    if (this.isVirtualSession(sessionId)) {
      this.virtualSessionRuntime?.cancel(sessionId);
      return;
    }

    const session = this.sessionState.getSession(sessionId);
    if (!session) { return; }

    const connInfo = this.connectionManager.getConnection(session.agentId);
    if (!connInfo) { return; }

    log(`Cancelling turn for session ${sessionId}`);
    await connInfo.connection.cancel({ sessionId });
  }

  /**
   * Set the session mode (e.g., plan mode, code mode).
   *
   * If the active session uses `configOptions`, this is transparently
   * routed to `setConfigOption` against the first option whose category is
   * `mode` — this keeps user keybindings working across agents that have
   * migrated to the new API.
   */
  async setMode(sessionId: string, modeId: string): Promise<void> {
    const session = this.sessionState.getSession(sessionId);
    if (!session) { return; }

    // Prefer configOptions if available
    if (session.configOptions && session.configOptions.length > 0) {
      const modeOpt = session.configOptions.find(o => o.category === 'mode');
      if (modeOpt) {
        await this.setConfigOption(sessionId, modeOpt.id, modeId);
        return;
      }
    }

    const connInfo = this.connectionManager.getConnection(session.agentId);
    if (!connInfo) { return; }

    await connInfo.connection.setSessionMode({ sessionId, modeId });

    // Update local state
    if (session.modes) {
      session.modes.currentModeId = modeId;
    }
    this.emit('mode-changed', sessionId, modeId);
  }

  /**
   * Set the session model (experimental).
   *
   * If the active session uses `configOptions`, this is transparently
   * routed to `setConfigOption` against the first option whose category is
   * `model`.
   */
  async setModel(sessionId: string, modelId: string): Promise<void> {
    const session = this.sessionState.getSession(sessionId);
    if (!session) { return; }

    if (session.configOptions && session.configOptions.length > 0) {
      const modelOpt = session.configOptions.find(o => o.category === 'model');
      if (modelOpt) {
        await this.setConfigOption(sessionId, modelOpt.id, modelId);
        return;
      }
    }

    const connInfo = this.connectionManager.getConnection(session.agentId);
    if (!connInfo) { return; }

    await (connInfo.connection as any).unstable_setSessionModel({ sessionId, modelId });

    // Update local state
    if (session.models) {
      session.models.currentModelId = modelId;
    }
    this.emit('model-changed', sessionId, modelId);
  }

  /**
   * Set a generic session config option (ACP "Session Config Options").
   * The agent's response contains the full configOptions array — we
   * replace our local copy so that cascading changes (e.g. changing the
   * model adjusts thought-level options) are reflected.
   */
  async setConfigOption(sessionId: string, configId: string, value: string): Promise<SessionConfigOption[] | null> {
    const session = this.sessionState.getSession(sessionId);
    if (!session) { return null; }

    const connInfo = this.connectionManager.getConnection(session.agentId);
    if (!connInfo) { return null; }

    const response = await connInfo.connection.setSessionConfigOption({
      sessionId,
      configId,
      value,
    });

    const options = (response as any)?.configOptions ?? null;
    this.applyConfigOptions(sessionId, options);
    return options;
  }

  // --- Cleanup ---

  dispose(): void {
    this.agentManager.killAll();
    this.connectionManager.dispose();
    this.sessionState.dispose();
    this.updateBuffer.clear();
    this.discussionContextHandler.dispose();
  }
}

function textFromSessionUpdate(updateData: any): string | null {
  const content = updateData?.content;
  return content?.type === 'text' && typeof content.text === 'string'
    ? content.text
    : null;
}
