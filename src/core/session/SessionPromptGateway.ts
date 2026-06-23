import type { PromptResponse, ContentBlock, SessionConfigOption } from '@agentclientprotocol/sdk';

import { ConnectionManager } from '../ConnectionManager';
import { DiscussionContextHandler } from '../DiscussionContextHandler';
import { SessionState } from '../SessionState';
import type { VirtualSessionRuntime } from '../VirtualSessionRuntime';
import { buildPromptWithSkills } from '../../skills/SkillsPromptBuilder';
import { log } from '../../utils/Logger';

export type SessionPromptGatewayEmitter = (
  event: string,
  ...args: any[]
) => boolean;

export interface SessionPromptGatewayDeps {
  sessionState: SessionState;
  connectionManager: ConnectionManager;
  discussionContextHandler: DiscussionContextHandler;
  getVirtualSessionRuntime: () => VirtualSessionRuntime | null;
  isVirtualSession: (sessionId: string | null | undefined) => boolean;
  applyConfigOptions: (sessionId: string, options: SessionConfigOption[] | null) => void;
  emit: SessionPromptGatewayEmitter;
}

export class SessionPromptGateway {
  constructor(private readonly deps: SessionPromptGatewayDeps) {}

  async sendPrompt(sessionId: string, text: string): Promise<PromptResponse> {
    const textWithSharedContext = this.deps.discussionContextHandler.consumePending(sessionId, text);
    const session = this.deps.sessionState.getSession(sessionId);
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    if (session.transport === 'virtual') {
      const runtime = this.deps.getVirtualSessionRuntime();
      if (!runtime) {
        throw new Error('Virtual session runtime is not available.');
      }
      return runtime.sendPrompt(sessionId, textWithSharedContext, session.agentName);
    }

    const connInfo = this.deps.connectionManager.getConnection(session.agentId);
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
      this.deps.sessionState.addSession(session);
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

  async cancelTurn(sessionId: string): Promise<void> {
    if (this.deps.isVirtualSession(sessionId)) {
      this.deps.getVirtualSessionRuntime()?.cancel(sessionId);
      return;
    }

    const session = this.deps.sessionState.getSession(sessionId);
    if (!session) { return; }

    const connInfo = this.deps.connectionManager.getConnection(session.agentId);
    if (!connInfo) { return; }

    log(`Cancelling turn for session ${sessionId}`);
    await connInfo.connection.cancel({ sessionId });
  }

  async setMode(sessionId: string, modeId: string): Promise<void> {
    const session = this.deps.sessionState.getSession(sessionId);
    if (!session) { return; }

    const connInfo = this.deps.connectionManager.getConnection(session.agentId);
    if (!connInfo) { return; }

    await connInfo.connection.setSessionMode({ sessionId, modeId });

    if (session.modes) {
      session.modes.currentModeId = modeId;
    }
    this.deps.emit('mode-changed', sessionId, modeId);
  }

  async setModel(sessionId: string, modelId: string): Promise<void> {
    const session = this.deps.sessionState.getSession(sessionId);
    if (!session) { return; }

    const connInfo = this.deps.connectionManager.getConnection(session.agentId);
    if (!connInfo) { return; }

    await (connInfo.connection as any).unstable_setSessionModel({ sessionId, modelId });

    if (session.models) {
      session.models.currentModelId = modelId;
    }
    this.deps.emit('model-changed', sessionId, modelId);
  }

  async setConfigOption(sessionId: string, configId: string, value: string): Promise<SessionConfigOption[] | null> {
    const session = this.deps.sessionState.getSession(sessionId);
    if (!session) { return null; }

    const connInfo = this.deps.connectionManager.getConnection(session.agentId);
    if (!connInfo) { return null; }

    const response = await connInfo.connection.setSessionConfigOption({
      sessionId,
      configId,
      value,
    });

    const options = (response as any)?.configOptions ?? null;
    this.deps.applyConfigOptions(sessionId, options);
    return options;
  }
}
