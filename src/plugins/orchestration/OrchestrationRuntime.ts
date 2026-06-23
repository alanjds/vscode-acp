import type { PromptResponse } from '@agentclientprotocol/sdk';
import type * as vscode from 'vscode';

import { getTeamEntryForAgent, isValidTeamVirtualAgentName } from '../../config/AgentTeamCatalog';
import { getPipelineDefinitionForAgent } from '../../config/PipelineCatalog';
import { isVirtualAgentName, resolveAgent } from '../../config/VirtualAgentCatalog';
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
    return isVirtualAgentName(agentName);
  }

  createSession(agentName: string, cwd: string): VirtualSessionDescriptor {
    const resolution = resolveAgent(agentName, cwd);
    if (resolution?.kind === 'team' && !isValidTeamVirtualAgentName(agentName)) {
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

  private projectorContext() {
    return {
      activeSessionId: this.sessions.getActiveSessionId(),
      isLoading: (sessionId: string) => this.sessions.isLoading(sessionId),
    };
  }

  private forwardProjection(
    input: Parameters<SessionManager['projectAndApply']>[0],
  ): void {
    const projection = this.sessions.projectAndApply(input, this.projectorContext());
    for (const message of projection.webviewMessages) {
      this.chat.postMessage(message);
    }
  }

  private readonly handleStatus = (event: PipelineStatusEvent): void => {
    this.forwardProjection({ kind: 'pipeline-status', event });
  };

  private readonly handlePlanReady = (event: PipelinePlanReadyEvent): void => {
    this.forwardProjection({ kind: 'pipeline-plan-ready', event });
  };

  private readonly handleSessionUpdate = (event: PipelineSessionUpdateEvent): void => {
    this.forwardProjection({ kind: 'pipeline-session-update', event });
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
