import type { SessionNotification } from '@agentclientprotocol/sdk';
import { INTERRUPT } from '@langchain/langgraph';

import type { PipelineDefinition, PipelinePrimitiveDefinition } from '../../config/PipelineCatalog';
import type { CompiledTeamMetadata } from '../AgentTeamCompiler';
import type { PipelineSessionUpdateEvent } from '../PipelineEvents';
import type { PendingApprovalState, PipelineRunState } from '../PipelineRunRegistry';
import { extractSingleProposedPlan } from '../ProposedPlan';
import type { PipelineTimelineEmitter } from './PipelineTimelineEmitter';
import { buildRevisionPrompt, findPlannerStepId, formatPipelineRoleLabel } from './PipelineRoleLabels';

export interface PlanRevisionDependencies {
  findPrimitiveForExecutorKind: (
    pipeline: PipelineDefinition,
    kind: string,
  ) => PipelinePrimitiveDefinition;
  runConfiguredAcpAgent: (
    sessionId: string,
    kind: string,
    promptText: string,
    onSessionUpdate?: (update: SessionNotification) => void,
  ) => Promise<string>;
  readTeamContext: (pipeline: PipelineDefinition) => CompiledTeamMetadata | undefined;
  emitPlanReady: (
    sessionId: string,
    state: PipelineRunState,
    plan: string,
    approvalStepId: string,
    revised: boolean,
  ) => void;
  emitSessionUpdate: (event: PipelineSessionUpdateEvent) => void;
  isPipelineAborted: (sessionId: string, state: PipelineRunState, error: unknown) => boolean;
  deleteRun: (sessionId: string) => void;
}

export async function revisePendingPlan(
  sessionId: string,
  state: PipelineRunState,
  feedback: string,
  timeline: PipelineTimelineEmitter,
  deps: PlanRevisionDependencies,
): Promise<string> {
  const pendingApproval = state.pendingApproval;
  if (!pendingApproval) {
    throw new Error('No pending pipeline plan for this session.');
  }

  const plannerStepId = findPlannerStepId(state.pipeline);
  const teamContext = deps.readTeamContext(state.pipeline);
  const plannerRole = teamContext?.roleByStepId[plannerStepId];
  const plannerPrimitive = deps.findPrimitiveForExecutorKind(state.pipeline, plannerStepId);
  const revisionPrompt = buildRevisionPrompt(
    state.originalUserPrompt,
    pendingApproval.plan,
    feedback,
  );

  state.revisionCount += 1;
  state.abortController = new AbortController();

  const statusMessage = plannerRole
    ? `${formatPipelineRoleLabel(plannerRole)} (${plannerPrimitive.agent})…`
    : `Revising plan with ${plannerPrimitive.agent}...`;
  timeline.emitStatus(
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
    const output = await deps.runConfiguredAcpAgent(
      sessionId,
      plannerStepId,
      revisionPrompt,
      update => {
        deps.emitSessionUpdate({
          sessionId,
          phase: plannerStepId,
          update,
          stepId: plannerStepId,
          role: plannerRole,
          agentName: plannerRole ? teamContext?.agentByRole[plannerRole] : undefined,
          teamId: teamContext?.teamId,
        });
      },
    );
    const revisedPlan = extractSingleProposedPlan(output);
    state.pendingApproval = {
      stepId: pendingApproval.stepId,
      plan: revisedPlan,
    };
    state.stepOutputs.set(plannerStepId, revisedPlan);
    deps.emitPlanReady(sessionId, state, revisedPlan, pendingApproval.stepId, true);
    return revisedPlan;
  } catch (e: any) {
    if (deps.isPipelineAborted(sessionId, state, e)) {
      deps.deleteRun(sessionId);
      throw e;
    }
    timeline.emitStatus(sessionId, 'error', e.message || 'Plan revision failed.', plannerStepId);
    throw e;
  }
}

export function readApprovalInterrupt(result: any): PendingApprovalState | null {
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
