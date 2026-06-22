import { EventEmitter } from 'node:events';

import type { SessionNotification } from '@agentclientprotocol/sdk';
import { Command, INTERRUPT, MemorySaver } from '@langchain/langgraph';

import { getAgentConfigs, isSandcastleAgentConfig, type AgentConfigEntry } from '../config/AgentConfig';
import {
  getPipelineDefinitionForAgent,
  getPipelineDefinitions,
  type PipelineDefinition,
  type PipelinePrimitiveDefinition,
} from '../config/PipelineCatalog';
import { getTeamEntryForAgent } from '../config/AgentTeamCatalog';
import { defaultGitCommandRunner } from '../git/GitCommandRunner';
import { SandcastleApplyError } from '../sandcastle/SandcastlePromotion';
import type { SandcastlePromotion } from '../sandcastle/SandcastlePromotion';
import { AcpAgentRunner, type AcpAgentRunResult } from './AcpAgentRunner';
import type { CompiledTeamMetadata } from '../pipeline/AgentTeamCompiler';
import type { TeamRoleId } from '../config/AgentTeamConfig';
import { assertSingleProposedPlan, extractSingleProposedPlan } from './ProposedPlan';
import { isRunAbortedError } from './RunAbortedError';
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
  implementerUsesSandcastle?: boolean;
}

export interface PipelinePlanReadyEvent {
  sessionId: string;
  plan: string;
  stepId: string;
  role?: TeamRoleId;
  agentName?: string;
  teamId?: string;
  implementerUsesSandcastle?: boolean;
  revised?: boolean;
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
  originalUserPrompt: string;
  revisionCount: number;
  cancelled: boolean;
  abortController: AbortController;
  approvedPlan?: string;
  implementOutput?: string;
  stepOutputs: Map<string, string>;
}

function buildRevisionPrompt(originalUserPrompt: string, currentPlan: string, feedback: string): string {
  return [
    'Original user request:',
    originalUserPrompt,
    '',
    'Current proposed plan:',
    currentPlan,
    '',
    'User revision request:',
    feedback,
    '',
    'Revise the plan based on the user\'s feedback.',
    'Return exactly one <proposed_plan>...</proposed_plan> block.',
  ].join('\n');
}

export interface PipelineServiceDependencies {
  getPipelineDefinitions?: () => PipelineDefinition[];
  getPipelineDefinitionForAgent?: (agentName: string) => PipelineDefinition | null;
  getAgentConfigs?: () => Record<string, unknown>;
  runAcpAgent?: (...args: Parameters<AcpRunCallback>) => Promise<string | AcpAgentRunResult>;
  sandcastlePromotion?: SandcastlePromotion;
}

class SandcastlePromotionRejectedError extends Error {}
class SandcastlePromotionCancelledError extends Error {}

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
    const existing = this.runs.get(sessionId);
    if (existing?.pendingApproval) {
      return this.revisePendingPlan(sessionId, existing, userPrompt);
    }

    const pipeline = this.readPipelineDefinition(pipelineAgentName);
    this.assertConfiguredAgents(pipeline);

    const state: PipelineRunState = {
      pipeline,
      graph: this.compileGraph(sessionId, pipeline),
      pendingApproval: null,
      originalUserPrompt: userPrompt,
      revisionCount: 0,
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
      if (e instanceof SandcastlePromotionRejectedError) {
        this.emitStatus(sessionId, 'rejected', 'Sandcastle changes were rejected.', 'implementer');
        this.runs.delete(sessionId);
        return '';
      }
      if (e instanceof SandcastlePromotionCancelledError) {
        this.emitStatus(sessionId, 'cancelled', 'Sandcastle promotion was cancelled.', 'implementer');
        this.runs.delete(sessionId);
        return '';
      }
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
      this.emitStatus(
        sessionId,
        'error',
        e.message || 'Pipeline implementation failed.',
        e instanceof SandcastleApplyError ? 'implementer' : undefined,
      );
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

    const runner = this.createAcpAgentRunner();
    const collected: SessionNotification[] = [];
    try {
      const result = await runner.run(reviewerRole, reviewerPrompt, {
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
      return result.text;
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

  private async revisePendingPlan(
    sessionId: string,
    state: PipelineRunState,
    feedback: string,
  ): Promise<string> {
    const pendingApproval = state.pendingApproval;
    if (!pendingApproval) {
      throw new Error('No pending pipeline plan for this session.');
    }

    const plannerStepId = this.findPlannerStepId(state.pipeline);
    const teamContext = this.readTeamContext(state.pipeline);
    const plannerRole = teamContext?.roleByStepId[plannerStepId];
    const plannerPrimitive = this.findPrimitiveForExecutorKind(state.pipeline, plannerStepId);
    const revisionPrompt = buildRevisionPrompt(
      state.originalUserPrompt,
      pendingApproval.plan,
      feedback,
    );

    state.revisionCount += 1;
    state.abortController = new AbortController();

    const statusMessage = plannerRole
      ? `${this.formatRoleLabel(plannerRole)} (${plannerPrimitive.agent})…`
      : `Revising plan with ${plannerPrimitive.agent}...`;
    this.emitStatus(
      sessionId,
      'planning',
      statusMessage,
      plannerStepId,
      undefined,
      teamContext,
      plannerRole,
      plannerPrimitive.agent,
    );

    try {
      const output = await this.runConfiguredAcpAgent(
        sessionId,
        plannerStepId,
        revisionPrompt,
        update => {
          this.emit('session-update', {
            sessionId,
            phase: plannerStepId,
            update,
            stepId: plannerStepId,
            role: plannerRole,
            agentName: plannerRole ? teamContext?.agentByRole[plannerRole] : undefined,
            teamId: teamContext?.teamId,
          } satisfies PipelineSessionUpdateEvent);
        },
      );
      const revisedPlan = extractSingleProposedPlan(output);
      state.pendingApproval = {
        stepId: pendingApproval.stepId,
        plan: revisedPlan,
      };
      state.stepOutputs.set(plannerStepId, revisedPlan);
      this.emitPlanReady(sessionId, state, revisedPlan, pendingApproval.stepId, true);
      return revisedPlan;
    } catch (e: any) {
      if (this.isPipelineAborted(sessionId, state, e)) {
        this.runs.delete(sessionId);
        throw e;
      }
      this.emitStatus(sessionId, 'error', e.message || 'Plan revision failed.', plannerStepId);
      throw e;
    }
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
      this.emitPlanReady(sessionId, state, interrupt.plan, interrupt.stepId, false);
      return interrupt.plan;
    }

    this.persistTeamSnapshot(sessionId, state, result);
    this.emitStatus(sessionId, 'completed', completionMessage, undefined, undefined, this.readTeamContext(state.pipeline));
    this.runs.delete(sessionId);
    return typeof result?.lastOutput === 'string' ? result.lastOutput : '';
  }

  private emitPlanReady(
    sessionId: string,
    state: PipelineRunState,
    plan: string,
    approvalStepId: string,
    revised: boolean,
  ): void {
    const teamContext = this.readTeamContext(state.pipeline);
    const plannerStepId = this.findPlannerStepId(state.pipeline);
    const plannerRole = teamContext?.roleByStepId[plannerStepId];
    const implementerUsesSandcastle = this.implementerUsesSandcastle(state.pipeline);
    const approvalMessage = revised
      ? 'Plan revised — review and approve.'
      : implementerUsesSandcastle
        ? 'Plan ready — approve before Sandcastle implementation.'
        : 'Plan ready for review.';
    this.emit('plan-ready', {
      sessionId,
      plan,
      stepId: approvalStepId,
      role: plannerRole,
      agentName: plannerRole ? teamContext?.agentByRole[plannerRole] : undefined,
      teamId: teamContext?.teamId,
      implementerUsesSandcastle,
      revised,
    } satisfies PipelinePlanReadyEvent);
    this.emitStatus(
      sessionId,
      'awaiting_approval',
      approvalMessage,
      approvalStepId,
      undefined,
      teamContext,
      undefined,
      undefined,
      implementerUsesSandcastle,
    );
  }

  private findPlannerStepId(pipeline: PipelineDefinition): string {
    for (const step of pipeline.steps) {
      if ('type' in step && step.type === 'approval') {
        break;
      }
      if ('use' in step) {
        const primitive = pipeline.primitives[step.use];
        if (primitive.output === 'proposed_plan') {
          return step.id;
        }
      }
    }
    throw new Error('Pipeline has no planner step with proposed_plan output.');
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

    if (primitive.sideEffects === 'workspace' && !state.approvedPlan) {
      throw new Error('Workspace side effects require an approved plan.');
    }

    if (this.dependencies.runAcpAgent) {
      const result = await this.dependencies.runAcpAgent(
        kind,
        promptText,
        onSessionUpdate,
        state.abortController.signal,
      );
      return this.resolveAgentRunResult(result);
    }

    const runner = this.createAcpAgentRunner();
    const result = await runner.run(primitive.agent, promptText, {
      onSessionUpdate,
      signal: state.abortController.signal,
      sideEffects: primitive.sideEffects,
    });
    return this.resolveAgentRunResult(result);
  }

  private createAcpAgentRunner(): AcpAgentRunner {
    const promotion = this.dependencies.sandcastlePromotion;
    if (!promotion) {
      throw new Error('PipelineService requires sandcastlePromotion in dependencies.');
    }
    return new AcpAgentRunner(() => this.workspaceCwd(), promotion);
  }

  private resolveAgentRunResult(result: string | AcpAgentRunResult): string {
    if (typeof result === 'string') {
      return result;
    }
    if (result.promotion === 'rejected') {
      throw new SandcastlePromotionRejectedError();
    }
    if (result.promotion === 'cancelled') {
      throw new SandcastlePromotionCancelledError();
    }
    return result.text;
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

  private implementerUsesSandcastle(pipeline: PipelineDefinition): boolean {
    const implementer = pipeline.primitives.implementer;
    if (!implementer?.agent) {
      return false;
    }
    const config = this.readAgentConfigs()[implementer.agent] as AgentConfigEntry | undefined;
    return config ? isSandcastleAgentConfig(config) : false;
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
    implementerUsesSandcastle?: boolean,
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
      implementerUsesSandcastle,
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
