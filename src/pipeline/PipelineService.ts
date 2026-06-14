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
import { AcpAgentRunner } from './AcpAgentRunner';
import { assertSingleProposedPlan } from './ProposedPlan';
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
}

export interface PipelinePlanReadyEvent {
  sessionId: string;
  plan: string;
  stepId: string;
}

export interface PipelineSessionUpdateEvent {
  sessionId: string;
  phase: PipelineExecutorKind;
  update: SessionNotification;
  stepId?: string;
  branchId?: string;
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
}

export interface PipelineServiceDependencies {
  getPipelineDefinitions?: () => PipelineDefinition[];
  getPipelineDefinitionForAgent?: (agentName: string) => PipelineDefinition | null;
  getAgentConfigs?: () => Record<string, unknown>;
  runAcpAgent?: AcpRunCallback;
}

export class PipelineService extends EventEmitter {
  private readonly runs: Map<string, PipelineRunState> = new Map();
  private readonly checkpointer = new MemorySaver();

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
    };
    this.runs.set(sessionId, state);

    try {
      const result = await state.graph.invoke(
        createInitialPipelineState(userPrompt),
        this.graphConfig(sessionId),
      );
      return this.handleGraphResult(sessionId, state, result, 'Pipeline completed.');
    } catch (e: any) {
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

    try {
      const result = await state.graph.invoke(
        new Command({ resume: { approved: true, plan: approvedOutput } }),
        this.graphConfig(sessionId),
      );
      return this.handleGraphResult(sessionId, state, result, 'Pipeline completed.');
    } catch (e: any) {
      this.emitStatus(sessionId, 'error', e.message || 'Pipeline implementation failed.');
      this.runs.delete(sessionId);
      throw e;
    }
  }

  rejectPlan(sessionId: string): void {
    const state = this.runs.get(sessionId);
    if (state) {
      state.cancelled = true;
    }
    this.runs.delete(sessionId);
    this.emitStatus(sessionId, 'rejected', 'Pipeline plan rejected.');
  }

  cancel(sessionId: string): void {
    const state = this.runs.get(sessionId);
    if (state) {
      state.cancelled = true;
    }
    this.runs.delete(sessionId);
    this.emitStatus(sessionId, 'cancelled', 'Pipeline cancelled.');
  }

  async dispose(): Promise<void> {
    for (const [sessionId, state] of this.runs) {
      state.cancelled = true;
      this.emitStatus(sessionId, 'cancelled', 'Pipeline cancelled.');
    }
    this.runs.clear();
    this.removeAllListeners();
  }

  private compileGraph(sessionId: string, pipeline: PipelineDefinition): CompiledPipelineGraph {
    const compiler = new PipelineGraphCompiler(
      async (kind, promptText, onSessionUpdate) =>
        this.runConfiguredAcpAgent(sessionId, kind, promptText, onSessionUpdate),
      {
        onStepStart: (stepId, primitive, branchId) => {
          const phase = this.getStepPhase(pipeline, stepId);
          this.emitStatus(
            sessionId,
            phase,
            `Running ${branchId ? `${stepId}/${branchId}` : stepId} with ${primitive.agent}...`,
            stepId,
            branchId,
          );
        },
        onStepSessionUpdate: (stepId, update, branchId) => {
          this.emit('session-update', {
            sessionId,
            phase: branchId ? `${stepId}/${branchId}` : stepId,
            update,
            stepId,
            branchId,
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
      this.emit('plan-ready', {
        sessionId,
        plan: interrupt.plan,
        stepId: interrupt.stepId,
      } satisfies PipelinePlanReadyEvent);
      this.emitStatus(sessionId, 'awaiting_approval', 'Plan ready for review.', interrupt.stepId);
      return interrupt.plan;
    }

    this.emitStatus(sessionId, 'completed', completionMessage);
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
    let approvalSeen = false;
    for (const step of pipeline.steps) {
      if (step.id === stepId) {
        return approvalSeen ? 'implementing' : 'planning';
      }
      if ('type' in step && step.type === 'approval') {
        approvalSeen = true;
      }
    }
    return 'planning';
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

    if (this.dependencies.runAcpAgent) {
      return this.dependencies.runAcpAgent(kind, promptText, onSessionUpdate);
    }

    const primitive = this.findPrimitiveForExecutorKind(state.pipeline, kind);
    const runner = new AcpAgentRunner(this.workspaceCwd);
    return runner.run(primitive.agent, promptText, {
      onSessionUpdate,
    });
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
  ): void {
    this.emit('status', {
      sessionId,
      status,
      message,
      stepId,
      branchId,
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
