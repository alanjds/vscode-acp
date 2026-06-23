import { EventEmitter } from 'node:events';

import type { SessionNotification } from '@agentclientprotocol/sdk';
import { MemorySaver } from '@langchain/langgraph';

import { getAgentConfigs, isSandcastleAgentConfig, type AgentConfigEntry } from '../config/AgentConfig';
import {
  getPipelineDefinitionForAgent,
  getPipelineDefinitions,
  type PipelineDefinition,
  type PipelinePrimitiveDefinition,
} from '../config/PipelineCatalog';
import type { TeamRoleId } from '../config/AgentTeamConfig';
import { isRunAbortedError } from '../core/RunAbortedError';
import { DefaultEphemeralAgentRunner } from '../core/EphemeralAgentRunner';
import type { SandcastlePromotion } from '../sandcastle/SandcastlePromotion';
import { SandcastleApplyError } from '../sandcastle/SandcastlePromotion';
import type { CompiledTeamMetadata } from './AgentTeamCompiler';
import {
  isPipelineStepCancelled,
  isPipelineStepRejected,
  type PipelineStepRunResult,
} from './PipelineStepCompletion';
import { PipelineExecutor } from './PipelineExecutor';
import {
  type AcpRunCallback,
} from './PipelineGraphCompiler';
import type { PipelinePlanReadyEvent, PipelineSessionUpdateEvent, PipelineStatus } from './PipelineEvents';
import { PipelineRunRegistry, type PipelineRunState } from './PipelineRunRegistry';
import { assertSingleProposedPlan } from './ProposedPlan';
import { TeamRunSnapshotStore } from './TeamRunSnapshotStore';
import { revisePendingPlan } from './engine/PipelinePlanRevision';
import {
  findPlannerStepId,
} from './engine/PipelineRoleLabels';
import { createPipelineTimelineEmitter } from './engine/PipelineTimelineEmitter';
import { PipelineGraphCoordinator } from './engine/PipelineGraphCoordinator';

export interface PipelineRunEngineDependencies {
  getPipelineDefinitions?: () => PipelineDefinition[];
  getPipelineDefinitionForAgent?: (agentName: string) => PipelineDefinition | null;
  getAgentConfigs?: () => Record<string, unknown>;
  runAcpAgent?: (...args: Parameters<AcpRunCallback>) => Promise<PipelineStepRunResult>;
  sandcastlePromotion?: SandcastlePromotion;
}

export class PipelineRunEngine extends EventEmitter {
  private readonly registry = new PipelineRunRegistry();
  private readonly checkpointer = new MemorySaver();
  private readonly executor: PipelineExecutor;
  private readonly snapshotStore: TeamRunSnapshotStore;
  private readonly timeline = createPipelineTimelineEmitter(this);
  private readonly graphCoordinator: PipelineGraphCoordinator;

  constructor(
    private readonly workspaceCwd: () => string,
    private readonly dependencies: PipelineRunEngineDependencies = {},
  ) {
    super();
    this.executor = new PipelineExecutor({
      workspaceCwd: this.workspaceCwd,
      ephemeralRunner: new DefaultEphemeralAgentRunner(this.dependencies.sandcastlePromotion),
      runAcpAgent: this.dependencies.runAcpAgent,
    });
    this.snapshotStore = new TeamRunSnapshotStore({
      workspaceCwd: this.workspaceCwd,
      readAgentConfigs: () => this.readAgentConfigs(),
      executor: this.executor,
      emitSessionUpdate: event => {
        this.emit('session-update', event);
      },
    });
    this.graphCoordinator = new PipelineGraphCoordinator(this.executor, this.checkpointer, {
      getRunState: sessionId => this.registry.get(sessionId),
      setStepOutput: (sessionId, kind, output, implementOutput) => {
        const state = this.registry.get(sessionId);
        if (!state) {
          return;
        }
        state.stepOutputs.set(kind, output);
        if (implementOutput) {
          state.implementOutput = output;
        }
      },
      throwIfCancelled: state => this.registry.throwIfCancelled(state),
      emitPlanReady: (sessionId, state, plan, approvalStepId, revised) => {
        this.emitPlanReady(sessionId, state, plan, approvalStepId, revised);
      },
      emitStatus: (...args) => this.emitStatus(...args),
      emitSessionUpdate: event => {
        this.emit('session-update', event);
      },
      persistTeamSnapshot: (sessionId, state, result) => {
        this.snapshotStore.persistTeamSnapshot(sessionId, state, result);
      },
      deleteRun: sessionId => {
        this.registry.delete(sessionId);
      },
      findPrimitiveForExecutorKind: (pipeline, kind) => this.findPrimitiveForExecutorKind(pipeline, kind),
      readTeamContext: pipeline => this.readTeamContext(pipeline),
      runConfiguredAcpAgent: (sessionId, kind, promptText, onSessionUpdate) =>
        this.runConfiguredAcpAgent(sessionId, kind, promptText, onSessionUpdate),
    });
  }

  async createPlan(sessionId: string, userPrompt: string, pipelineAgentName?: string): Promise<string> {
    const existing = this.registry.get(sessionId);
    if (existing?.pendingApproval) {
      return revisePendingPlan(sessionId, existing, userPrompt, this.timeline, this.planRevisionDeps());
    }

    const pipeline = this.readPipelineDefinition(pipelineAgentName);
    this.assertConfiguredAgents(pipeline);

    const state: PipelineRunState = {
      pipeline,
      graph: this.graphCoordinator.compileGraph(sessionId, pipeline),
      pendingApproval: null,
      originalUserPrompt: userPrompt,
      revisionCount: 0,
      cancelled: false,
      abortController: new AbortController(),
      stepOutputs: new Map(),
    };
    this.registry.set(sessionId, state);

    try {
      const result = await this.graphCoordinator.invokeInitial(sessionId, state, userPrompt);
      return this.graphCoordinator.handleGraphResult(sessionId, state, result, 'Pipeline completed.');
    } catch (e: any) {
      if (this.handlePipelineStepStop(sessionId, e)) {
        return '';
      }
      if (this.isPipelineAborted(sessionId, state, e)) {
        this.registry.delete(sessionId);
        throw e;
      }
      this.emitStatus(sessionId, 'error', e.message || 'Pipeline failed.');
      this.registry.delete(sessionId);
      throw e;
    }
  }

  async approvePlan(sessionId: string, approvedPlan: string): Promise<string> {
    const state = this.registry.get(sessionId);
    if (!state?.pendingApproval) {
      throw new Error('No pending pipeline plan for this session.');
    }

    const approvedOutput = approvedPlan.trim();
    assertSingleProposedPlan(approvedOutput);
    state.pendingApproval = null;
    state.approvedPlan = approvedOutput;
    state.abortController = new AbortController();

    try {
      const result = await this.graphCoordinator.resumeAfterApproval(sessionId, state, approvedOutput);
      return this.graphCoordinator.handleGraphResult(sessionId, state, result, 'Pipeline completed.');
    } catch (e: any) {
      if (this.handlePipelineStepStop(sessionId, e)) {
        return '';
      }
      if (this.isPipelineAborted(sessionId, state, e)) {
        this.registry.delete(sessionId);
        throw e;
      }
      this.emitStatus(
        sessionId,
        'error',
        e.message || 'Pipeline implementation failed.',
        e instanceof SandcastleApplyError ? 'implementer' : undefined,
      );
      this.registry.delete(sessionId);
      throw e;
    }
  }

  rejectPlan(sessionId: string): void {
    this.registry.markCancelled(sessionId);
    this.registry.delete(sessionId);
    this.emitStatus(sessionId, 'rejected', 'Pipeline plan rejected.');
  }

  cancel(sessionId: string): void {
    this.registry.markCancelled(sessionId);
    this.registry.delete(sessionId);
    this.emitStatus(sessionId, 'cancelled', 'Pipeline cancelled.');
  }

  async dispose(): Promise<void> {
    this.snapshotStore.abortReviewerRerunOnDispose();
    for (const [sessionId, state] of this.registry.entries()) {
      state.cancelled = true;
      state.abortController.abort();
      this.emitStatus(sessionId, 'cancelled', 'Pipeline cancelled.');
    }
    this.registry.clear();
    this.removeAllListeners();
  }

  getLastTeamRunSnapshot() {
    return this.snapshotStore.getLastTeamRunSnapshot();
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
    this.snapshotStore.cancelReviewerRerun();
  }

  async rerunTeamReviewer(teamAgentName: string): Promise<string> {
    return this.snapshotStore.rerunTeamReviewer(teamAgentName);
  }

  private planRevisionDeps() {
    return {
      findPrimitiveForExecutorKind: this.findPrimitiveForExecutorKind.bind(this),
      runConfiguredAcpAgent: this.runConfiguredAcpAgent.bind(this),
      readTeamContext: this.readTeamContext.bind(this),
      emitPlanReady: this.emitPlanReady.bind(this),
      emitSessionUpdate: (event: PipelineSessionUpdateEvent) => {
        this.emit('session-update', event);
      },
      isPipelineAborted: this.isPipelineAborted.bind(this),
      deleteRun: (sessionId: string) => {
        this.registry.delete(sessionId);
      },
    };
  }

  private emitPlanReady(
    sessionId: string,
    state: PipelineRunState,
    plan: string,
    approvalStepId: string,
    revised: boolean,
  ): void {
    const teamContext = this.readTeamContext(state.pipeline);
    const plannerStepId = findPlannerStepId(state.pipeline);
    const plannerRole = teamContext?.roleByStepId[plannerStepId];
    const implementerUsesSandcastle = this.implementerUsesSandcastle(state.pipeline);
    const approvalMessage = revised
      ? 'Plan revised — review and approve.'
      : implementerUsesSandcastle
        ? 'Plan ready — approve before Sandcastle implementation.'
        : 'Plan ready for review.';
    this.timeline.emitPlanReady(
      sessionId,
      {
        sessionId,
        plan,
        stepId: approvalStepId,
        role: plannerRole,
        agentName: plannerRole ? teamContext?.agentByRole[plannerRole] : undefined,
        teamId: teamContext?.teamId,
        implementerUsesSandcastle,
        revised,
      } satisfies PipelinePlanReadyEvent,
      approvalMessage,
      approvalStepId,
      teamContext,
      implementerUsesSandcastle,
    );
  }

  private readTeamContext(pipeline: PipelineDefinition): CompiledTeamMetadata | undefined {
    return pipeline.metadata?.sourceKind === 'team' ? pipeline.metadata : undefined;
  }

  private async runConfiguredAcpAgent(
    sessionId: string,
    kind: string,
    promptText: string,
    onSessionUpdate?: (update: SessionNotification) => void,
  ): Promise<string> {
    const state = this.registry.get(sessionId);
    if (!state || state.cancelled) {
      throw new Error('Pipeline cancelled.');
    }

    const primitive = this.findPrimitiveForExecutorKind(state.pipeline, kind);

    return this.executor.runStep(kind, primitive, promptText, {
      signal: state.abortController.signal,
      approvedPlan: state.approvedPlan,
      onSessionUpdate,
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

  private handlePipelineStepStop(sessionId: string, error: unknown): boolean {
    if (isPipelineStepRejected(error)) {
      this.emitStatus(sessionId, 'rejected', 'Sandcastle changes were rejected.', 'implementer');
      this.registry.delete(sessionId);
      return true;
    }
    if (isPipelineStepCancelled(error)) {
      this.emitStatus(sessionId, 'cancelled', 'Sandcastle promotion was cancelled.', 'implementer');
      this.registry.delete(sessionId);
      return true;
    }
    return false;
  }

  private findPrimitiveForExecutorKind(
    pipeline: PipelineDefinition,
    kind: string,
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
    this.timeline.emitStatus(
      sessionId,
      status,
      message,
      stepId,
      branchId,
      teamContext,
      role,
      agentName,
      implementerUsesSandcastle,
    );
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
