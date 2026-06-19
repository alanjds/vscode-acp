import { EventEmitter } from 'node:events';

import type { SessionNotification } from '@agentclientprotocol/sdk';
import { Command, INTERRUPT, MemorySaver } from '@langchain/langgraph';

import { getAgentConfigs } from '../config/AgentConfig';
import {
  getPipelineDefinitionForAgent,
  getPipelineDefinitions,
  type PipelineDefinition,
  type PipelinePrimitiveDefinition,
} from '../config/PipelineCatalog';
import { getTeamEntryForAgent } from '../config/AgentTeamCatalog';
import { defaultGitCommandRunner } from '../sandbox/GitCommandRunner';
import { AcpAgentRunner } from './AcpAgentRunner';
import type { CompiledTeamMetadata } from '../pipeline/AgentTeamCompiler';
import type { TeamRoleId } from '../config/AgentTeamConfig';
import { assertSingleProposedPlan } from './ProposedPlan';
import { isRunAbortedError } from './RunAbortedError';
import { isSandboxEnabled } from '../sandbox/SandboxConfig';
import { runSandboxedAcpAgent } from '../sandbox/sandboxedAgentRun';
import type { SandboxPromotionPanel } from '../sandbox/SandboxPromotionPanel';
import type { SandboxService } from '../sandbox/SandboxService';
import {
  type AcpRunCallback,
  type CompiledPipelineGraph,
  createInitialPipelineState,
  PipelineGraphCompiler,
} from './PipelineGraphCompiler';

export type PipelineStatus =
  | 'planning'
  | 'awaiting_approval'
  | 'implementing'
  | 'reviewing'
  | 'testing'
  | 'completed'
  | 'rejected'
  | 'error'
  | 'cancelled';

export interface PipelineStatusEvent {
  sessionId: string;
  status: PipelineStatus;
  message: string;
  stepId?: string;
  branchId?: string;
  role?: TeamRoleId;
  agentName?: string;
  teamId?: string;
}

export interface PipelinePlanReadyEvent {
  sessionId: string;
  plan: string;
  stepId: string;
  role?: TeamRoleId;
  agentName?: string;
  teamId?: string;
}

export interface PipelineSessionUpdateEvent {
  sessionId: string;
  phase: PipelineExecutorKind;
  update: SessionNotification;
  stepId?: string;
  branchId?: string;
  role?: TeamRoleId;
  agentName?: string;
  teamId?: string;
}

export interface TeamRunSnapshot {
  sessionId: string;
  teamId: string;
  teamTitle: string;
  approvedPlan: string;
  implementOutput: string;
  completedAt: string;
}

export type PipelineExecutorKind = string;

interface PendingApprovalState {
  stepId: string;
  plan: string;
}

interface PipelineRunState {
  pipeline: PipelineDefinition;
  graph: CompiledPipelineGraph;
  pendingApproval: PendingApprovalState | null;
  cancelled: boolean;
  abortController: AbortController;
  approvedPlan?: string;
  implementOutput?: string;
  stepOutputs: Map<string, string>;
}

export interface PipelineServiceDependencies {
  getPipelineDefinitions?: () => PipelineDefinition[];
  getPipelineDefinitionForAgent?: (agentName: string) => PipelineDefinition | null;
  getAgentConfigs?: () => Record<string, unknown>;
  runAcpAgent?: AcpRunCallback;
  sandboxService?: SandboxService;
  sandboxPromotionPanel?: SandboxPromotionPanel;
  isSandboxEnabled?: () => boolean;
}

export class PipelineService extends EventEmitter {
  private readonly runs: Map<string, PipelineRunState> = new Map();
  private readonly checkpointer = new MemorySaver();
  private lastTeamRunSnapshot: TeamRunSnapshot | null = null;
  private reviewerRerunAbortController: AbortController | null = null;

  constructor(
    private readonly workspaceCwd: () => string,
    private readonly dependencies: PipelineServiceDependencies = {},
  ) {
    super();
  }

  async createPlan(sessionId: string, userPrompt: string, pipelineAgentName?: string): Promise<string> {
    const pipeline = this.readPipelineDefinition(pipelineAgentName);
    this.assertConfiguredAgents(pipeline);

    const state: PipelineRunState = {
      pipeline,
      graph: this.compileGraph(sessionId, pipeline),
      pendingApproval: null,
      cancelled: false,
      abortController: new AbortController(),
      stepOutputs: new Map(),
    };
    this.runs.set(sessionId, state);

    try {
      const result = await state.graph.invoke(
        createInitialPipelineState(userPrompt),
        this.graphConfig(sessionId),
      );
      return this.handleGraphResult(sessionId, state, result, 'Pipeline completed.');
    } catch (e: any) {
      if (this.isPipelineAborted(sessionId, state, e)) {
        this.runs.delete(sessionId);
        throw e;
      }
      this.emitStatus(sessionId, 'error', e.message || 'Pipeline failed.');
      this.runs.delete(sessionId);
      throw e;
    }
  }

  async approvePlan(sessionId: string, approvedPlan: string): Promise<string> {
    const state = this.runs.get(sessionId);
    if (!state?.pendingApproval) {
      throw new Error('No pending pipeline plan for this session.');
    }

    const approvedOutput = approvedPlan.trim();
    assertSingleProposedPlan(approvedOutput);
    state.pendingApproval = null;
    state.approvedPlan = approvedOutput;
    state.abortController = new AbortController();

    try {
      const result = await state.graph.invoke(
        new Command({ resume: { approved: true, plan: approvedOutput } }),
        this.graphConfig(sessionId),
      );
      return this.handleGraphResult(sessionId, state, result, 'Pipeline completed.');
    } catch (e: any) {
      if (this.isPipelineAborted(sessionId, state, e)) {
        this.runs.delete(sessionId);
        throw e;
      }
      this.emitStatus(sessionId, 'error', e.message || 'Pipeline implementation failed.');
      this.runs.delete(sessionId);
      throw e;
    }
  }

  rejectPlan(sessionId: string): void {
    const state = this.runs.get(sessionId);
    if (state) {
      state.cancelled = true;
      state.abortController.abort();
    }
    this.runs.delete(sessionId);
    this.emitStatus(sessionId, 'rejected', 'Pipeline plan rejected.');
  }

  cancel(sessionId: string): void {
    const state = this.runs.get(sessionId);
    if (state) {
      state.cancelled = true;
      state.abortController.abort();
    }
    this.runs.delete(sessionId);
    this.emitStatus(sessionId, 'cancelled', 'Pipeline cancelled.');
  }

  async dispose(): Promise<void> {
    this.reviewerRerunAbortController?.abort();
    for (const [sessionId, state] of this.runs) {
      state.cancelled = true;
      state.abortController.abort();
      this.emitStatus(sessionId, 'cancelled', 'Pipeline cancelled.');
    }
    this.runs.clear();
    this.removeAllListeners();
  }

  getLastTeamRunSnapshot(): TeamRunSnapshot | null {
    return this.lastTeamRunSnapshot;
  }

  getCompiledPipelineForTeam(agentName: string): PipelineDefinition | null {
    const definition = this.dependencies.getPipelineDefinitionForAgent?.(agentName)
      ?? getPipelineDefinitionForAgent(agentName, this.workspaceCwd(), this.readAgentConfigs());
    if (!definition?.metadata || definition.metadata.sourceKind !== 'team') {
      return null;
    }
    return definition;
  }

  cancelReviewerRerun(): void {
    this.reviewerRerunAbortController?.abort();
    this.reviewerRerunAbortController = null;
  }

  async rerunTeamReviewer(teamAgentName: string): Promise<string> {
    const snapshot = this.lastTeamRunSnapshot;
    if (!snapshot) {
      throw new Error('No completed team run is available for reviewer re-run.');
    }

    const entry = getTeamEntryForAgent(teamAgentName, this.workspaceCwd(), this.readAgentConfigs());
    if (!entry?.pipeline?.metadata) {
      throw new Error(`Team "${teamAgentName}" is not available.`);
    }

    const reviewerRole = entry.pipeline.metadata.agentByRole.reviewer;
    if (!reviewerRole) {
      throw new Error('Team has no reviewer role configured.');
    }

    const diff = await this.readWorkspaceDiff();
    const reviewerInstructions = entry.pipeline.primitives.reviewer.prompt
      .split('\n')
      .filter(line => !line.includes('{{'))
      .join('\n')
      .trim();
    const reviewerPrompt = [
      reviewerInstructions,
      '',
      'Original request:',
      '(see archived team run)',
      '',
      'Approved plan:',
      snapshot.approvedPlan,
      '',
      'Implementation output:',
      snapshot.implementOutput,
      '',
      'Current workspace diff (git diff HEAD):',
      diff || '(no diff detected)',
    ].join('\n');

    this.reviewerRerunAbortController?.abort();
    const abortController = new AbortController();
    this.reviewerRerunAbortController = abortController;

    const runner = new AcpAgentRunner(this.workspaceCwd);
    const collected: SessionNotification[] = [];
    try {
      const output = await runner.run(reviewerRole, reviewerPrompt, {
        signal: abortController.signal,
        onSessionUpdate: update => {
          collected.push(update);
          this.emit('session-update', {
            sessionId: snapshot.sessionId,
            phase: 'reviewer-rerun',
            update,
            stepId: 'reviewer',
            role: 'reviewer',
            agentName: reviewerRole,
            teamId: snapshot.teamId,
          } satisfies PipelineSessionUpdateEvent);
        },
      });
      return output;
    } finally {
      if (this.reviewerRerunAbortController === abortController) {
        this.reviewerRerunAbortController = null;
      }
    }
  }

  private async readWorkspaceDiff(): Promise<string> {
    try {
      const result = await defaultGitCommandRunner.exec(this.workspaceCwd(), ['diff', 'HEAD']);
      return result.stdout.trim();
    } catch {
      return '';
    }
  }

  private compileGraph(sessionId: string, pipeline: PipelineDefinition): CompiledPipelineGraph {
    const teamContext = this.readTeamContext(pipeline);
    const compiler = new PipelineGraphCompiler(
      async (kind, promptText, onSessionUpdate) => {
        const output = await this.runConfiguredAcpAgent(sessionId, kind, promptText, onSessionUpdate);
        const state = this.runs.get(sessionId);
        if (state) {
          state.stepOutputs.set(kind, output);
          if (kind === 'implementer') {
            state.implementOutput = output;
          }
        }
        return output;
      },
      {
        onStepStart: (stepId, primitive, branchId) => {
          const phase = this.getStepPhase(pipeline, stepId);
          const role = teamContext?.roleByStepId[stepId];
          const statusMessage = role
            ? `${this.formatRoleLabel(role)} (${primitive.agent})…`
            : `Running ${branchId ? `${stepId}/${branchId}` : stepId} with ${primitive.agent}...`;
          this.emitStatus(
            sessionId,
            phase,
            statusMessage,
            stepId,
            branchId,
            teamContext,
            role,
            primitive.agent,
          );
        },
        onStepSessionUpdate: (stepId, update, branchId) => {
          const role = teamContext?.roleByStepId[stepId];
          const agentName = role ? teamContext?.agentByRole[role] : undefined;
          this.emit('session-update', {
            sessionId,
            phase: branchId ? `${stepId}/${branchId}` : stepId,
            update,
            stepId,
            branchId,
            role,
            agentName,
            teamId: teamContext?.teamId,
          } satisfies PipelineSessionUpdateEvent);
        },
      },
      this.checkpointer,
    );
    return compiler.compile(pipeline);
  }

  private handleGraphResult(
    sessionId: string,
    state: PipelineRunState,
    result: any,
    completionMessage: string,
  ): string {
    this.throwIfCancelled(state);
    const interrupt = this.readApprovalInterrupt(result);
    if (interrupt) {
      assertSingleProposedPlan(interrupt.plan);
      state.pendingApproval = interrupt;
      const teamContext = this.readTeamContext(state.pipeline);
      const plannerRole = teamContext?.roleByStepId[interrupt.stepId];
      this.emit('plan-ready', {
        sessionId,
        plan: interrupt.plan,
        stepId: interrupt.stepId,
        role: plannerRole,
        agentName: plannerRole ? teamContext?.agentByRole[plannerRole] : undefined,
        teamId: teamContext?.teamId,
      } satisfies PipelinePlanReadyEvent);
      this.emitStatus(sessionId, 'awaiting_approval', 'Plan ready for review.', interrupt.stepId, undefined, teamContext);
      return interrupt.plan;
    }

    this.persistTeamSnapshot(sessionId, state, result);
    this.emitStatus(sessionId, 'completed', completionMessage, undefined, undefined, this.readTeamContext(state.pipeline));
    this.runs.delete(sessionId);
    return typeof result?.lastOutput === 'string' ? result.lastOutput : '';
  }

  private readApprovalInterrupt(result: any): PendingApprovalState | null {
    const interrupts = result?.[INTERRUPT];
    if (!Array.isArray(interrupts) || interrupts.length === 0) {
      return null;
    }
    const value = interrupts[0]?.value;
    if (!value || typeof value.stepId !== 'string' || typeof value.plan !== 'string') {
      throw new Error('Pipeline approval interrupt was malformed.');
    }
    return {
      stepId: value.stepId,
      plan: value.plan,
    };
  }

  private getStepPhase(pipeline: PipelineDefinition, stepId: string): PipelineStatus {
    if (stepId === 'reviewer') {
      return 'reviewing';
    }
    if (stepId === 'tester') {
      return 'testing';
    }

    let approvalSeen = false;
    for (const step of pipeline.steps) {
      if (step.id === stepId) {
        if (stepId === 'implementer' || (approvalSeen && stepId !== 'planner')) {
          return 'implementing';
        }
        return approvalSeen ? 'implementing' : 'planning';
      }
      if ('type' in step && step.type === 'approval') {
        approvalSeen = true;
      }
    }
    return 'planning';
  }

  private readTeamContext(pipeline: PipelineDefinition): CompiledTeamMetadata | undefined {
    return pipeline.metadata?.sourceKind === 'team' ? pipeline.metadata : undefined;
  }

  private formatRoleLabel(role: TeamRoleId): string {
    switch (role) {
      case 'planner':
        return 'Planning';
      case 'implementer':
        return 'Implementing';
      case 'reviewer':
        return 'Reviewing';
      case 'tester':
        return 'Testing';
    }
  }

  private persistTeamSnapshot(sessionId: string, state: PipelineRunState, result: any): void {
    const metadata = state.pipeline.metadata;
    if (!metadata || metadata.sourceKind !== 'team') {
      return;
    }

    const approvedPlan = state.approvedPlan
      ?? result?.stepOutputs?.approval?.output
      ?? '';
    const implementOutput = state.implementOutput
      ?? result?.stepOutputs?.implementer?.output
      ?? '';

    if (!approvedPlan || !implementOutput) {
      return;
    }

    this.lastTeamRunSnapshot = {
      sessionId,
      teamId: metadata.teamId,
      teamTitle: state.pipeline.title,
      approvedPlan,
      implementOutput,
      completedAt: new Date().toISOString(),
    };
  }

  private async runConfiguredAcpAgent(
    sessionId: string,
    kind: PipelineExecutorKind,
    promptText: string,
    onSessionUpdate?: (update: SessionNotification) => void,
  ): Promise<string> {
    const state = this.runs.get(sessionId);
    if (!state || state.cancelled) {
      throw new Error('Pipeline cancelled.');
    }

    const primitive = this.findPrimitiveForExecutorKind(state.pipeline, kind);

    if (this.dependencies.runAcpAgent) {
      return runSandboxedAcpAgent({
        primitive,
        workspaceCwd: this.workspaceCwd(),
        agentName: primitive.agent,
        promptText,
        signal: state.abortController.signal,
        onSessionUpdate,
        sandboxService: this.dependencies.sandboxService,
        sandboxPromotionPanel: this.dependencies.sandboxPromotionPanel,
        isSandboxEnabled: this.dependencies.isSandboxEnabled ?? isSandboxEnabled,
        runRunner: async (_cwd, sandbox) => this.dependencies.runAcpAgent!(
          kind,
          promptText,
          onSessionUpdate,
          state.abortController.signal,
          sandbox,
        ),
      });
    }

    return runSandboxedAcpAgent({
      primitive,
      workspaceCwd: this.workspaceCwd(),
      agentName: primitive.agent,
      promptText,
      signal: state.abortController.signal,
      onSessionUpdate,
      sandboxService: this.dependencies.sandboxService,
      sandboxPromotionPanel: this.dependencies.sandboxPromotionPanel,
      isSandboxEnabled: this.dependencies.isSandboxEnabled ?? isSandboxEnabled,
    });
  }

  private isPipelineAborted(sessionId: string, state: PipelineRunState, error: unknown): boolean {
    const aborted = state.cancelled
      || isRunAbortedError(error)
      || (error instanceof Error && error.message === 'Pipeline cancelled.');
    if (!aborted) {
      return false;
    }
    if (!state.cancelled) {
      state.cancelled = true;
      this.emitStatus(sessionId, 'cancelled', 'Pipeline cancelled.');
    }
    return true;
  }

  private findPrimitiveForExecutorKind(
    pipeline: PipelineDefinition,
    kind: PipelineExecutorKind,
  ): PipelinePrimitiveDefinition {
    for (const step of pipeline.steps) {
      if ('use' in step && step.id === kind) {
        return pipeline.primitives[step.use];
      }
      if ('type' in step && step.type === 'parallel') {
        for (const branch of step.branches) {
          if (`${step.id}__${branch.id}` === kind) {
            return pipeline.primitives[branch.use];
          }
        }
      }
    }
    throw new Error(`Unable to resolve pipeline executor "${kind}".`);
  }

  private assertConfiguredAgents(pipeline: PipelineDefinition): void {
    const agents = this.readAgentConfigs();
    const missing = Object.values(pipeline.primitives)
      .map(primitive => primitive.agent)
      .filter((agentName, index, names) => !agents[agentName] && names.indexOf(agentName) === index);
    if (missing.length > 0) {
      throw new Error(`Missing configured ACP pipeline agent(s): ${missing.join(', ')}.`);
    }
  }

  private throwIfCancelled(state: PipelineRunState): void {
    if (state.cancelled) {
      throw new Error('Pipeline cancelled.');
    }
  }

  private graphConfig(sessionId: string): { configurable: { thread_id: string } } {
    return { configurable: { thread_id: sessionId } };
  }

  private emitStatus(
    sessionId: string,
    status: PipelineStatus,
    message: string,
    stepId?: string,
    branchId?: string,
    teamContext?: CompiledTeamMetadata,
    role?: TeamRoleId,
    agentName?: string,
  ): void {
    this.emit('status', {
      sessionId,
      status,
      message,
      stepId,
      branchId,
      role,
      agentName,
      teamId: teamContext?.teamId,
    } satisfies PipelineStatusEvent);
  }

  private readPipelineDefinition(pipelineAgentName?: string): PipelineDefinition {
    if (pipelineAgentName) {
      const definition = this.dependencies.getPipelineDefinitionForAgent?.(pipelineAgentName)
        ?? getPipelineDefinitionForAgent(pipelineAgentName, this.workspaceCwd(), this.readAgentConfigs());
      if (definition) {
        return definition;
      }
    }

    const definitions = this.dependencies.getPipelineDefinitions?.()
      ?? getPipelineDefinitions(this.workspaceCwd(), this.readAgentConfigs());
    const definition = pipelineAgentName
      ? definitions.find(candidate => candidate.title === pipelineAgentName)
      : definitions[0];
    if (!definition) {
      throw new Error(pipelineAgentName
        ? `Unknown ACP pipeline "${pipelineAgentName}".`
        : 'No ACP pipelines are configured.');
    }
    return definition;
  }

  private readAgentConfigs(): Record<string, unknown> {
    return this.dependencies.getAgentConfigs?.() ?? getAgentConfigs();
  }
}
