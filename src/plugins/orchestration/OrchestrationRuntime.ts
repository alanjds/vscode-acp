import type { PromptResponse, SessionNotification } from '@agentclientprotocol/sdk';
import type * as vscode from 'vscode';

import { getTeamEntryForAgent, isTeamVirtualAgentName, isValidTeamVirtualAgentName } from '../../config/AgentTeamCatalog';
import { getPipelineDefinitionForAgent, isPipelineVirtualAgentName } from '../../config/PipelineCatalog';
import type { SessionManager } from '../../core/SessionManager';
import type { VirtualSessionDescriptor, VirtualSessionRuntime } from '../../core/VirtualSessionRuntime';
import type {
  PipelineService,
  PipelinePlanReadyEvent,
  PipelineSessionUpdateEvent,
  PipelineStatusEvent,
} from '../../pipeline/PipelineService';
import type { ChatWebviewController } from '../../ui/ChatWebviewController';
import { logError } from '../../utils/Logger';

function assistantTextUpdate(text: string, sessionId: string): SessionNotification {
  return {
    sessionId,
    update: {
      sessionUpdate: 'agent_message_chunk',
      content: { type: 'text', text },
    },
  } as SessionNotification;
}

/** Owns every runtime concern of virtual orchestration conversations. */
export class OrchestrationRuntime implements VirtualSessionRuntime, vscode.Disposable {
  private sequence = 0;
  private readonly disposables: vscode.Disposable[] = [];
  private activated = false;
  private disposed = false;

  constructor(
    readonly pipelines: PipelineService,
    private readonly sessions: SessionManager,
    private readonly chat: ChatWebviewController,
  ) {}

  activate(): vscode.Disposable {
    if (this.activated) {
      throw new Error('Orchestration runtime is already active.');
    }
    this.activated = true;
    this.pipelines.on('status', this.handleStatus);
    this.pipelines.on('plan-ready', this.handlePlanReady);
    this.pipelines.on('session-update', this.handleSessionUpdate);
    try {
      this.disposables.push(this.sessions.registerVirtualSessionRuntime(this));
      this.disposables.push(this.chat.registerFeatureMessageHandler('approvePipelinePlan', async message => {
        await this.approve(String(message.plan ?? ''));
      }));
      this.disposables.push(this.chat.registerFeatureMessageHandler('rejectPipelinePlan', () => this.reject()));
    } catch (error) {
      this.dispose();
      throw error;
    }
    return this;
  }

  canHandle(agentName: string): boolean {
    return isPipelineVirtualAgentName(agentName) || isTeamVirtualAgentName(agentName);
  }

  createSession(agentName: string, cwd: string): VirtualSessionDescriptor {
    if (isTeamVirtualAgentName(agentName) && !isValidTeamVirtualAgentName(agentName)) {
      const entry = getTeamEntryForAgent(agentName);
      throw new Error(`Invalid agent team: ${entry?.errors.join('; ') ?? 'configuration error'}`);
    }
    this.sequence += 1;
    const identity = `${Date.now()}_${this.sequence}`;
    return {
      sessionId: `pipeline_${identity}`,
      agentId: `pipeline_agent_${identity}`,
      displayName: getPipelineDefinitionForAgent(agentName, cwd)?.title ?? agentName,
    };
  }

  async sendPrompt(sessionId: string, text: string, agentName: string): Promise<PromptResponse> {
    await this.pipelines.createPlan(sessionId, text, agentName);
    return { stopReason: 'end_turn' } as PromptResponse;
  }

  cancel(sessionId: string): void {
    this.pipelines.cancel(sessionId);
  }

  private readonly handleStatus = (event: PipelineStatusEvent): void => {
    if (event.sessionId !== this.sessions.getActiveSessionId()) { return; }
    this.chat.postMessage({
      type: 'pipelineStatus',
      status: event.status,
      message: event.message,
      stepId: event.stepId,
      role: event.role,
      agentName: event.agentName,
      teamId: event.teamId,
      implementerUsesSandcastle: event.implementerUsesSandcastle,
    });
  };

  private readonly handlePlanReady = (event: PipelinePlanReadyEvent): void => {
    if (event.plan) {
      this.sessions.ingestSessionUpdate(
        event.sessionId,
        assistantTextUpdate(event.plan, event.sessionId),
      );
    }
    if (event.sessionId !== this.sessions.getActiveSessionId()) { return; }
    this.chat.postMessage({
      type: 'pipelinePlanReady',
      plan: event.plan,
      role: event.role,
      agentName: event.agentName,
      teamId: event.teamId,
      implementerUsesSandcastle: event.implementerUsesSandcastle,
      revised: event.revised === true,
    });
  };

  private readonly handleSessionUpdate = (event: PipelineSessionUpdateEvent): void => {
    this.sessions.ingestSessionUpdate(event.sessionId, event.update);
    if (event.sessionId !== this.sessions.getActiveSessionId()) { return; }
    this.chat.postMessage({
      type: 'sessionUpdate',
      update: event.update.update,
      sessionId: event.sessionId,
      phase: event.phase,
      role: event.role,
      agentName: event.agentName,
      teamId: event.teamId,
    });
  };

  private async approve(plan: string): Promise<void> {
    const sessionId = this.sessions.getActiveSessionId();
    if (!sessionId || !this.sessions.isVirtualSession(sessionId)) { return; }
    this.chat.postMessage({ type: 'promptStart' });
    try {
      await this.pipelines.approvePlan(sessionId, plan);
      this.chat.postMessage({ type: 'promptEnd', stopReason: 'end_turn' });
      this.sessions.touchHistory(sessionId);
    } catch (error: any) {
      logError('Pipeline implementation failed', error);
      this.chat.postMessage({ type: 'pipelinePlanApprovalFailed', message: error.message || 'Pipeline implementation failed' });
      this.chat.postMessage({ type: 'error', message: error.message || 'Pipeline implementation failed' });
      this.chat.postMessage({ type: 'promptEnd', stopReason: 'error' });
    }
  }

  private reject(): void {
    const sessionId = this.sessions.getActiveSessionId();
    if (sessionId && this.sessions.isVirtualSession(sessionId)) {
      this.pipelines.rejectPlan(sessionId);
    }
  }

  dispose(): void {
    if (this.disposed) { return; }
    this.disposed = true;
    this.pipelines.off('status', this.handleStatus);
    this.pipelines.off('plan-ready', this.handlePlanReady);
    this.pipelines.off('session-update', this.handleSessionUpdate);
    for (const disposable of this.disposables.splice(0).reverse()) {
      disposable.dispose();
    }
    void this.pipelines.dispose();
  }
}
