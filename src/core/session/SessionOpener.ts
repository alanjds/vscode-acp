import type { SessionInfo as ProtocolSessionInfo } from '@agentclientprotocol/sdk';

import type { ConnectionInfo } from '../ConnectionManager';
import { DiscussionContextHandler } from '../DiscussionContextHandler';
import { SessionAuthHandler } from '../SessionAuthHandler';
import { SessionState } from '../SessionState';
import { SessionUpdateBuffer } from '../SessionUpdateBuffer';
import type { SessionConnector } from './SessionConnector';
import type { OpenSessionOptions, SessionInfo } from './sessionTypes';
import {
  applySharedDiscussionContextHandoff,
  resolveSharedContextForSessionOpen,
} from './sessionSwitchHelpers';

export type SessionOpenerEmitter = (
  event: string,
  ...args: any[]
) => boolean;

export interface SessionOpenerDeps {
  sessionState: SessionState;
  updateBuffer: SessionUpdateBuffer;
  authHandler: SessionAuthHandler;
  discussionContextHandler: DiscussionContextHandler;
  connector: SessionConnector;
  findAgentIdForConnection: (conn: ConnectionInfo) => string | undefined;
  getWorkspaceCwd: () => string;
  emit: SessionOpenerEmitter;
}

export class SessionOpener {
  constructor(private readonly deps: SessionOpenerDeps) {}

  async loadSession(agentName: string, sessionId: string, options: OpenSessionOptions = {}): Promise<SessionInfo> {
    const sharedDiscussionContext = resolveSharedContextForSessionOpen(
      this.deps.discussionContextHandler,
      this.deps.sessionState,
      options,
      agentName,
      sessionId,
    );

    const currentAgent = this.deps.sessionState.getActiveAgentName();
    if (currentAgent && currentAgent !== agentName) {
      await this.deps.connector.disconnectAgent(currentAgent);
    }

    const conn = await this.deps.connector.ensureConnected(agentName);
    const caps = this.deps.sessionState.getCachedCapabilities(agentName);
    if (!caps?.load) {
      throw new Error(`Agent "${agentName}" does not support session/load.`);
    }

    this.deps.sessionState.replaceActiveSession(sessionId);

    const cwd = this.deps.getWorkspaceCwd();
    const agentId = this.deps.findAgentIdForConnection(conn);
    if (!agentId) {
      throw new Error(`Unable to locate agent process for "${agentName}".`);
    }
    this.deps.discussionContextHandler.getHistoryStore()?.upsertNew(agentName, cwd, sessionId);

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
    this.deps.sessionState.addSession(placeholder);
    this.deps.updateBuffer.drainInto(placeholder);
    this.deps.sessionState.markLoading(sessionId);
    this.deps.discussionContextHandler.getHistoryStore()?.clearDiscussion(agentName, sessionId);

    this.deps.sessionState.activateSession(agentName, sessionId);

    this.deps.emit('agent-connected', agentName);
    this.deps.emit('active-session-changed', sessionId);
    this.deps.emit('session-load-start', sessionId, agentName);

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
      this.deps.sessionState.removeSessionForAgent(agentName);
      this.deps.emit('session-load-end', sessionId, agentName, false);
      this.deps.emit('active-session-changed', null);

      const msg = String(e?.message || '');
      if (/not found|no such|unknown session/i.test(msg)) {
        this.deps.discussionContextHandler.getHistoryStore()?.markStatus(agentName, sessionId, 'missing');
      }
      throw e;
    }

    this.deps.sessionState.unmarkLoading(sessionId);
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
    this.deps.emit('session-load-end', sessionId, agentName, true);

    this.deps.discussionContextHandler.touchHistory(
      this.deps.sessionState.getSession(sessionId),
      sessionId,
    );
    return placeholder;
  }

  async resumeSession(agentName: string, sessionId: string, options: OpenSessionOptions = {}): Promise<SessionInfo> {
    const sharedDiscussionContext = resolveSharedContextForSessionOpen(
      this.deps.discussionContextHandler,
      this.deps.sessionState,
      options,
      agentName,
      sessionId,
    );

    const currentAgent = this.deps.sessionState.getActiveAgentName();
    if (currentAgent && currentAgent !== agentName) {
      await this.deps.connector.disconnectAgent(currentAgent);
    }

    const conn = await this.deps.connector.ensureConnected(agentName);
    const caps = this.deps.sessionState.getCachedCapabilities(agentName);
    if (!caps?.resume) {
      throw new Error(`Agent "${agentName}" does not support session/resume.`);
    }

    this.deps.sessionState.replaceActiveSession(sessionId);

    const cwd = this.deps.getWorkspaceCwd();
    const agentId = this.deps.findAgentIdForConnection(conn);
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
        this.deps.discussionContextHandler.getHistoryStore()?.markStatus(agentName, sessionId, 'missing');
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
    this.deps.sessionState.addSession(sessionInfo);
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
    this.deps.updateBuffer.drainInto(sessionInfo);
    this.deps.sessionState.activateSession(agentName, sessionId);
    this.deps.emit('agent-connected', agentName);
    this.deps.emit('active-session-changed', sessionId);

    this.deps.discussionContextHandler.touchHistory(
      this.deps.sessionState.getSession(sessionId),
      sessionId,
    );
    return sessionInfo;
  }

  async listSessions(
    agentName: string,
    opts: { cwd?: string; cursor?: string } = {},
  ): Promise<{ sessions: ProtocolSessionInfo[]; nextCursor?: string }> {
    const conn = await this.deps.connector.ensureConnected(agentName);
    const caps = this.deps.sessionState.getCachedCapabilities(agentName);
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
      if (this.deps.authHandler.isAuthRequiredError(e)) {
        const agentInfo = this.deps.findAgentIdForConnection(conn);
        if (agentInfo) {
          await this.deps.authHandler.runAuthFlow(agentName, agentInfo, conn);
          response = await conn.connection.listSessions(params);
        } else {
          throw e;
        }
      } else {
        throw e;
      }
    }

    const sessions: ProtocolSessionInfo[] = response?.sessions ?? [];
    if (this.deps.discussionContextHandler.getHistoryStore() && !opts.cursor) {
      this.deps.discussionContextHandler.getHistoryStore()!.reconcileFromAgent(
        agentName,
        new Set(sessions.map(s => s.sessionId)),
        opts.cwd,
      );
    }
    return { sessions, nextCursor: response?.nextCursor ?? undefined };
  }
}
