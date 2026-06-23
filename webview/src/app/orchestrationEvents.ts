import type { PipelinePhase, PipelinePlanStatus } from '../chatTypes';
import { normalizePipelinePhase as normalizeSharedPipelinePhase } from '../../../src/ui/PipelineTypes';
import {
  applyPipelineStatusToTimeline,
  createDefaultTeamTimeline,
  resolveTeamTimeline,
} from './OrchestrationProjector';
import type { AppAction } from './state';

export type OrchestrationHostMessage = {
  type: 'pipelinePlanReady';
  plan?: string;
  role?: PipelinePhase;
  agentName?: string;
  teamId?: string;
  implementerUsesSandcastle?: boolean;
  revised?: boolean;
} | {
  type: 'pipelinePlanApprovalFailed';
} | {
  type: 'pipelineStatus';
  status?: string;
  message?: string;
  stepId?: string;
  role?: PipelinePhase;
  agentName?: string;
  teamId?: string;
} | {
  type: 'reviewerRerunReady';
  output?: string;
};

export function normalizePipelinePhase(value: unknown): PipelinePhase | undefined {
  return normalizeSharedPipelinePhase(value) ?? undefined;
}

export function normalizePipelineStatus(value: unknown): PipelinePlanStatus | null {
  switch (value) {
    case 'awaiting_approval':
      return 'pending';
    case 'implementing':
    case 'completed':
    case 'rejected':
    case 'error':
    case 'cancelled':
      return value;
    default:
      return null;
  }
}

export function mapOrchestrationMessageToActions(
  message: OrchestrationHostMessage,
  currentTimeline: ReturnType<typeof createDefaultTeamTimeline>,
): AppAction[] {
  switch (message.type) {
    case 'pipelinePlanReady': {
      if (typeof message.plan !== 'string') {
        return [];
      }

      const actions: AppAction[] = [
        message.revised === true
          ? {
              type: 'revisePipelinePlan',
              plan: message.plan,
              role: normalizePipelinePhase(message.role),
              agentName: typeof message.agentName === 'string' ? message.agentName : undefined,
              implementerUsesSandcastle: message.implementerUsesSandcastle === true,
            }
          : {
              type: 'appendPipelinePlan',
              plan: message.plan,
              role: normalizePipelinePhase(message.role),
              agentName: typeof message.agentName === 'string' ? message.agentName : undefined,
              implementerUsesSandcastle: message.implementerUsesSandcastle === true,
            },
      ];

      if (typeof message.teamId === 'string' && message.revised !== true) {
        actions.push({
          type: 'updatePipelineTimeline',
          timeline: createDefaultTeamTimeline(false),
        });
      }

      return actions;
    }

    case 'pipelinePlanApprovalFailed':
      return [{ type: 'revertPipelinePlanApproval' }];

    case 'pipelineStatus': {
      const actions: AppAction[] = [];
      const status = normalizePipelineStatus(message.status);
      if (status) {
        actions.push({
          type: 'updatePipelinePlanStatus',
          status,
          message: typeof message.message === 'string' ? message.message : undefined,
        });
      }

      if (typeof message.teamId === 'string') {
        actions.push({
          type: 'updatePipelineTimeline',
          timeline: applyPipelineStatusToTimeline(
            resolveTeamTimeline(currentTimeline),
            typeof message.status === 'string' ? message.status : undefined,
            typeof message.stepId === 'string' ? message.stepId : undefined,
          ),
        });
      }

      const role = normalizePipelinePhase(message.role);
      if (role) {
        actions.push({
          type: 'setActivePipelineRole',
          role,
          agentName: typeof message.agentName === 'string' ? message.agentName : null,
        });
      }

      return actions;
    }

    case 'reviewerRerunReady':
      if (typeof message.output !== 'string') {
        return [];
      }
      return [{
        type: 'appendPipelineRoleOutput',
        role: 'reviewer-rerun',
        text: message.output,
        title: 'Review (rerun)',
      }];

    default:
      return [];
  }
}

export function mapSessionOrchestrationMetaToActions(
  role: PipelinePhase | undefined,
  agentName: string | undefined,
): AppAction[] {
  if (!role && !agentName) {
    return [];
  }

  return [{
    type: 'setActivePipelineRole',
    role: role ?? null,
    agentName: agentName ?? null,
  }];
}

export function shouldFinalizeTeamRoleTurn(
  activeRole: PipelinePhase | null,
  assistantText: string | undefined,
): boolean {
  return Boolean(activeRole && activeRole !== 'planner' && assistantText?.trim());
}
