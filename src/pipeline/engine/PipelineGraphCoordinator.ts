import type { SessionNotification } from '@agentclientprotocol/sdk';
import { Command, MemorySaver } from '@langchain/langgraph';

import type { TeamRoleId } from '../../config/AgentTeamConfig';
import type { PipelineDefinition, PipelinePrimitiveDefinition } from '../../config/PipelineCatalog';
import type { CompiledTeamMetadata } from '../AgentTeamCompiler';
import { PipelineExecutor } from '../PipelineExecutor';
import {
  type AcpRunCallback,
  type CompiledPipelineGraph,
  createInitialPipelineState,
  PipelineGraphCompiler,
} from '../PipelineGraphCompiler';
import type { PipelineSessionUpdateEvent, PipelineStatus } from '../PipelineEvents';
import type { PipelineRunState } from '../PipelineRunRegistry';
import { assertSingleProposedPlan } from '../ProposedPlan';
import { readApprovalInterrupt } from './PipelinePlanRevision';
import {
  formatPipelineRoleLabel,
  getPipelineStepPhase,
} from './PipelineRoleLabels';

export type PipelineGraphCoordinatorDeps = {
  getRunState: (sessionId: string) => PipelineRunState | undefined;
  setStepOutput: (sessionId: string, kind: string, output: string, implementOutput?: boolean) => void;
  throwIfCancelled: (state: PipelineRunState) => void;
  emitPlanReady: (
    sessionId: string,
    state: PipelineRunState,
    plan: string,
    approvalStepId: string,
    revised: boolean,
  ) => void;
  emitStatus: (
    sessionId: string,
    status: PipelineStatus,
    message: string,
    stepId?: string,
    branchId?: string,
    teamContext?: CompiledTeamMetadata,
    role?: TeamRoleId,
    agentName?: string,
    implementerUsesSandcastle?: boolean,
  ) => void;
  emitSessionUpdate: (event: PipelineSessionUpdateEvent) => void;
  persistTeamSnapshot: (sessionId: string, state: PipelineRunState, result: unknown) => void;
  deleteRun: (sessionId: string) => void;
  findPrimitiveForExecutorKind: (pipeline: PipelineDefinition, kind: string) => PipelinePrimitiveDefinition;
  readTeamContext: (pipeline: PipelineDefinition) => CompiledTeamMetadata | undefined;
  runConfiguredAcpAgent: (
    sessionId: string,
    kind: string,
    promptText: string,
    onSessionUpdate?: (update: SessionNotification) => void,
  ) => Promise<string>;
};

export class PipelineGraphCoordinator {
  constructor(
    private readonly executor: PipelineExecutor,
    private readonly checkpointer: MemorySaver,
    private readonly deps: PipelineGraphCoordinatorDeps,
  ) {}

  graphConfig(sessionId: string): { configurable: { thread_id: string } } {
    return { configurable: { thread_id: sessionId } };
  }

  compileGraph(sessionId: string, pipeline: PipelineDefinition): CompiledPipelineGraph {
    const teamContext = this.deps.readTeamContext(pipeline);
    const compiler = new PipelineGraphCompiler(
      async (kind, promptText, onSessionUpdate) => {
        const output = await this.deps.runConfiguredAcpAgent(sessionId, kind, promptText, onSessionUpdate);
        this.deps.setStepOutput(sessionId, kind, output, kind === 'implementer');
        return output;
      },
      {
        onStepStart: (stepId, primitive, branchId) => {
          const phase = getPipelineStepPhase(pipeline, stepId);
          const role = teamContext?.roleByStepId[stepId];
          const statusMessage = role
            ? `${formatPipelineRoleLabel(role)} (${primitive.agent})…`
            : `Running ${branchId ? `${stepId}/${branchId}` : stepId} with ${primitive.agent}...`;
          this.deps.emitStatus(
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
          this.deps.emitSessionUpdate({
            sessionId,
            phase: branchId ? `${stepId}/${branchId}` : stepId,
            update,
            stepId,
            branchId,
            role,
            agentName,
            teamId: teamContext?.teamId,
          });
        },
      },
      this.checkpointer,
    );
    return compiler.compile(pipeline);
  }

  async invokeInitial(
    sessionId: string,
    state: PipelineRunState,
    userPrompt: string,
  ): Promise<unknown> {
    return state.graph.invoke(
      createInitialPipelineState(userPrompt),
      this.graphConfig(sessionId),
    );
  }

  async resumeAfterApproval(
    sessionId: string,
    state: PipelineRunState,
    approvedPlan: string,
  ): Promise<unknown> {
    return state.graph.invoke(
      new Command({ resume: { approved: true, plan: approvedPlan } }),
      this.graphConfig(sessionId),
    );
  }

  handleGraphResult(
    sessionId: string,
    state: PipelineRunState,
    result: unknown,
    completionMessage: string,
  ): string {
    this.deps.throwIfCancelled(state);
    const interrupt = readApprovalInterrupt(result);
    if (interrupt) {
      assertSingleProposedPlan(interrupt.plan);
      state.pendingApproval = interrupt;
      this.deps.emitPlanReady(sessionId, state, interrupt.plan, interrupt.stepId, false);
      return interrupt.plan;
    }

    this.deps.persistTeamSnapshot(sessionId, state, result);
    this.deps.emitStatus(
      sessionId,
      'completed',
      completionMessage,
      undefined,
      undefined,
      this.deps.readTeamContext(state.pipeline),
    );
    this.deps.deleteRun(sessionId);
    return typeof (result as { lastOutput?: string })?.lastOutput === 'string'
      ? (result as { lastOutput: string }).lastOutput
      : '';
  }
}

export type { AcpRunCallback };
