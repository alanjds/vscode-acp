import { EventEmitter } from 'node:events';

import type {
  AvailableCommand,
  PromptResponse,
  SessionConfigOption,
  SessionInfo as ProtocolSessionInfo,
} from '@agentclientprotocol/sdk';
import type { OpenSessionOptions, OpenedSession, SessionInfo } from './session/sessionTypes';

import { AgentManager } from './AgentManager';
import { ConnectionManager, ConnectionInfo } from './ConnectionManager';
import { ContextFamilyInfo, SessionHistoryStore } from './SessionHistoryStore';
import { resolveWorkspaceIdentity, type WorkspaceIdentity } from './WorkspaceIdentity';
import { getAgentConfigs } from '../config/AgentConfig';
import { SessionState } from './SessionState';
import { SessionUpdateBuffer } from './SessionUpdateBuffer';
import { SessionAuthHandler } from './SessionAuthHandler';
import { DiscussionContextHandler } from './DiscussionContextHandler';
import type { VirtualSessionRuntime } from './VirtualSessionRuntime';
import {
  DefaultConversationProjector,
  type ConversationProjectorContext,
  type ConversationProjectorInput,
  type ConversationProjection,
} from './ConversationProjector';
import type { ConversationUpdateEffects } from './ConversationUpdateIngestor';
import { SessionConnector } from './session/SessionConnector';
import { SessionOpener } from './session/SessionOpener';
import { SessionPromptGateway } from './session/SessionPromptGateway';

export type { SessionInfo, OpenSessionOptions, OpenedSession } from './session/sessionTypes';
export type { AgentCapabilitySummary } from './SessionState';
export type { SharedDiscussionContext } from './DiscussionContextHandler';

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
  private readonly connector: SessionConnector;
  private readonly opener: SessionOpener;
  private readonly promptGateway: SessionPromptGateway;
  private virtualSessionRuntime: VirtualSessionRuntime | null = null;
  private readonly conversationProjector = new DefaultConversationProjector();

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

    const sharedDeps = {
      agentManager: this.agentManager,
      connectionManager: this.connectionManager,
      sessionState: this.sessionState,
      updateBuffer: this.updateBuffer,
      authHandler: this.authHandler,
      discussionContextHandler: this.discussionContextHandler,
      getConfigs: () => this.getConfigs(),
      getWorkspaceIdentity: () => this.getWorkspaceIdentity(),
      getWorkspaceCwd: () => this.getWorkspaceCwd(),
      getVirtualSessionRuntime: () => this.virtualSessionRuntime,
      disconnectAgent: (agentName: string) => this.disconnectAgent(agentName),
      emit: (event: string, ...args: any[]) => this.emit(event, ...args),
    };

    this.connector = new SessionConnector(sharedDeps);
    this.opener = new SessionOpener({
      sessionState: this.sessionState,
      updateBuffer: this.updateBuffer,
      authHandler: this.authHandler,
      discussionContextHandler: this.discussionContextHandler,
      connector: this.connector,
      findAgentIdForConnection: (conn) => this.findAgentIdForConnection(conn),
      getWorkspaceCwd: () => this.getWorkspaceCwd(),
      emit: sharedDeps.emit,
    });
    this.promptGateway = new SessionPromptGateway({
      sessionState: this.sessionState,
      connectionManager: this.connectionManager,
      discussionContextHandler: this.discussionContextHandler,
      getVirtualSessionRuntime: () => this.virtualSessionRuntime,
      isVirtualSession: (sessionId) => this.isVirtualSession(sessionId),
      applyConfigOptions: (sessionId, options) => this.applyConfigOptions(sessionId, options),
      emit: sharedDeps.emit,
    });
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

  async connectToAgent(agentName: string, options: OpenSessionOptions = {}): Promise<SessionInfo> {
    return this.connector.connectToAgent(agentName, options);
  }

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

  async disconnectAgent(agentName: string): Promise<void> {
    return this.connector.disconnectAgent(agentName);
  }

  applyConfigOptions(sessionId: string, options: SessionConfigOption[] | null): void {
    const session = this.sessionState.getSession(sessionId);
    if (!session) {
      this.updateBuffer.bufferConfigOptions(sessionId, options ?? []);
      return;
    }
    session.configOptions = options ?? null;
    this.emit('config-options-changed', sessionId, session.configOptions);
  }

  applyAvailableCommands(sessionId: string, commands: AvailableCommand[]): void {
    const session = this.sessionState.getSession(sessionId);
    if (!session) {
      this.updateBuffer.bufferAvailableCommands(sessionId, commands);
      return;
    }
    session.availableCommands = commands;
    this.emit('available-commands-changed', sessionId, commands);
  }

  applySessionInfoUpdate(sessionId: string, update: { title?: string | null; updatedAt?: string | null }): void {
    const session = this.sessionState.getSession(sessionId);
    if (session) {
      if (update.title === null) {
        delete session.title;
      } else if (typeof update.title === 'string') {
        session.title = update.title;
      }
    } else if (typeof update.title === 'string') {
      this.updateBuffer.bufferTitle(sessionId, update.title);
    }
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

  recordUserMessage(sessionId: string, text: string): void {
    const session = this.sessionState.getSession(sessionId);
    this.discussionContextHandler.recordFirstPrompt(session, sessionId, text);
    this.discussionContextHandler.recordUserMessage(session, sessionId, text);
  }

  recordUserMessageChunk(sessionId: string, text: string): void {
    this.discussionContextHandler.recordUserMessageChunk(
      this.sessionState.getSession(sessionId),
      sessionId,
      text,
    );
  }

  recordAssistantMessageChunk(sessionId: string, text: string): void {
    this.discussionContextHandler.recordAssistantMessageChunk(
      this.sessionState.getSession(sessionId),
      sessionId,
      text,
    );
  }

  applyConversationEffects(effects: ConversationUpdateEffects): void {
    const sessionId = effects.sessionId;
    if (effects.availableCommands) {
      this.applyAvailableCommands(sessionId, effects.availableCommands);
    }
    if (effects.configOptions !== undefined) {
      this.applyConfigOptions(sessionId, effects.configOptions);
    }
    if (effects.sessionInfo) {
      this.applySessionInfoUpdate(sessionId, effects.sessionInfo);
    }
    if (effects.assistantMessageChunk) {
      this.recordAssistantMessageChunk(sessionId, effects.assistantMessageChunk);
    }
    if (effects.replayedUserMessageChunk) {
      this.recordUserMessageChunk(sessionId, effects.replayedUserMessageChunk);
    }
  }

  projectAndApply(
    input: ConversationProjectorInput,
    ctx: ConversationProjectorContext,
  ): ConversationProjection {
    const projection = this.conversationProjector.project(input, ctx);
    this.applyConversationEffects(projection.sessionEffects);
    return projection;
  }

  private conversationProjectorContext(): ConversationProjectorContext {
    return {
      activeSessionId: this.getActiveSessionId(),
      isLoading: (sessionId) => this.isLoading(sessionId),
    };
  }

  touchHistory(sessionId: string): void {
    this.discussionContextHandler.touchHistory(
      this.sessionState.getSession(sessionId),
      sessionId,
    );
  }

  async ensureConnected(agentName: string): Promise<ConnectionInfo> {
    return this.connector.ensureConnected(agentName);
  }

  async listSessions(agentName: string, opts: { cwd?: string; cursor?: string } = {}): Promise<{ sessions: ProtocolSessionInfo[]; nextCursor?: string }> {
    return this.opener.listSessions(agentName, opts);
  }

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

  async loadSession(
    agentName: string,
    sessionId: string,
    options: OpenSessionOptions = {},
  ): Promise<SessionInfo> {
    return this.opener.loadSession(agentName, sessionId, options);
  }

  async resumeSession(
    agentName: string,
    sessionId: string,
    options: OpenSessionOptions = {},
  ): Promise<SessionInfo> {
    return this.opener.resumeSession(agentName, sessionId, options);
  }

  isLoading(sessionId: string): boolean {
    return this.sessionState.isLoading(sessionId);
  }

  hasPendingSharedDiscussionContext(sessionId: string): boolean {
    return this.discussionContextHandler.hasPending(sessionId);
  }

  getSession(sessionId: string): SessionInfo | undefined {
    return this.sessionState.getSession(sessionId);
  }

  getActiveSession(): SessionInfo | undefined {
    return this.sessionState.getActiveSession();
  }

  getActiveSessionId(): string | null {
    return this.sessionState.getActiveSessionId();
  }

  getActiveAgentName(): string | null {
    return this.sessionState.getActiveAgentName();
  }

  isAgentConnected(agentName: string): boolean {
    return this.sessionState.isAgentConnected(agentName);
  }

  getConnectedAgentNames(): string[] {
    return this.sessionState.getConnectedAgentNames();
  }

  getConnectionForSession(sessionId: string): ConnectionInfo | undefined {
    const session = this.sessionState.getSession(sessionId);
    if (!session) { return undefined; }
    return this.connectionManager.getConnection(session.agentId);
  }

  findAgentIdForConnection(conn: ConnectionInfo): string | undefined {
    return this.connector.findAgentIdForConnection(conn);
  }

  isVirtualSession(sessionId: string | null | undefined): boolean {
    if (!sessionId) { return false; }
    return this.sessionState.getSession(sessionId)?.transport === 'virtual';
  }

  async sendPrompt(sessionId: string, text: string): Promise<PromptResponse> {
    return this.promptGateway.sendPrompt(sessionId, text);
  }

  async cancelTurn(sessionId: string): Promise<void> {
    return this.promptGateway.cancelTurn(sessionId);
  }

  async setMode(sessionId: string, modeId: string): Promise<void> {
    const session = this.sessionState.getSession(sessionId);
    if (!session) { return; }

    if (session.configOptions && session.configOptions.length > 0) {
      const modeOpt = session.configOptions.find(o => o.category === 'mode');
      if (modeOpt) {
        await this.setConfigOption(sessionId, modeOpt.id, modeId);
        return;
      }
    }

    return this.promptGateway.setMode(sessionId, modeId);
  }

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

    return this.promptGateway.setModel(sessionId, modelId);
  }

  async setConfigOption(sessionId: string, configId: string, value: string): Promise<SessionConfigOption[] | null> {
    return this.promptGateway.setConfigOption(sessionId, configId, value);
  }

  dispose(): void {
    this.agentManager.killAll();
    this.connectionManager.dispose();
    this.sessionState.dispose();
    this.updateBuffer.clear();
    this.discussionContextHandler.dispose();
  }
}
