import type { ChatHistoryItem } from '../chatTypes';
import type {
  OrchestrationPlanState,
  OrchestrationRoleOutputState,
  OrchestrationState,
  PipelinePhase,
  PipelinePlanStatus,
  PipelineTimelineStep,
} from '../../../src/ui/OrchestrationStateCore';
import { emptyOrchestrationState } from '../../../src/ui/OrchestrationStateCore';
import type { PipelineTimelineStepStatus } from '../../../src/ui/PipelineTypes';

export type OrchestrationSlice = OrchestrationState;
export type PipelinePlanState = OrchestrationPlanState;
export type PipelineRoleOutputItem = OrchestrationRoleOutputState;

export type OrchestrationViewModel = {
  timeline: PipelineTimelineStep[];
  activeRole: PipelinePhase | null;
  activeAgentName: string | null;
  plan: PipelinePlanState | null;
  roleOutputs: PipelineRoleOutputItem[];
  hasTimeline: boolean;
  hasPendingPlan: boolean;
};

export function emptyOrchestrationSlice(): OrchestrationSlice {
  return emptyOrchestrationState();
}

export function resolveTeamTimeline(timeline: PipelineTimelineStep[]): PipelineTimelineStep[] {
  return timeline.length > 0 ? timeline : createDefaultTeamTimeline(false);
}

export function projectOrchestrationView(slice: OrchestrationSlice): OrchestrationViewModel {
  return {
    timeline: slice.timeline,
    activeRole: slice.activeRole,
    activeAgentName: slice.activeAgentName,
    plan: slice.plan,
    roleOutputs: slice.roleOutputs,
    hasTimeline: slice.timeline.length > 0,
    hasPendingPlan: slice.plan?.status === 'pending',
  };
}

export function selectOrchestrationView(state: { orchestration: OrchestrationSlice }): OrchestrationViewModel {
  return projectOrchestrationView(state.orchestration);
}

export function createDefaultTeamTimeline(includeTester = false): PipelineTimelineStep[] {
  const steps: PipelineTimelineStep[] = [
    { id: 'planner', label: 'Planner', status: 'pending' },
    { id: 'approval', label: 'Plan approval (human)', status: 'pending' },
    { id: 'implementer', label: 'Implementer', status: 'pending' },
    { id: 'reviewer', label: 'Reviewer', status: 'pending' },
  ];
  if (includeTester) {
    steps.push({ id: 'tester', label: 'Tester', status: 'pending' });
  }
  return steps;
}

export function applyPipelineStatusToTimeline(
  timeline: PipelineTimelineStep[],
  status: string | undefined,
  stepId?: string,
): PipelineTimelineStep[] {
  if (!status) {
    return timeline;
  }

  const next = timeline.map(step => ({ ...step }));

  const markDoneUntil = (targetId: string, includeTarget = false): void => {
    for (const step of next) {
      if (step.id === targetId) {
        if (includeTarget) {
          step.status = 'done';
        }
        break;
      }
      if (step.status !== 'error' && step.status !== 'skipped') {
        step.status = 'done';
      }
    }
  };

  switch (status) {
    case 'planning':
      markDoneUntil('planner');
      setStepStatus(next, 'planner', 'running');
      break;
    case 'awaiting_approval':
      markDoneUntil('approval');
      setStepStatus(next, 'planner', 'done');
      setStepStatus(next, 'approval', 'running');
      break;
    case 'implementing':
      markDoneUntil('implementer');
      setStepStatus(next, 'planner', 'done');
      setStepStatus(next, 'approval', 'done');
      setStepStatus(next, 'implementer', 'running');
      break;
    case 'reviewing':
      markDoneUntil('reviewer');
      setStepStatus(next, 'implementer', 'done');
      setStepStatus(next, 'reviewer', 'running');
      break;
    case 'testing':
      markDoneUntil('tester');
      setStepStatus(next, 'reviewer', 'done');
      setStepStatus(next, 'tester', 'running');
      break;
    case 'completed':
      for (const step of next) {
        if (step.status !== 'error' && step.status !== 'skipped') {
          step.status = 'done';
        }
      }
      break;
    case 'rejected':
      setStepStatus(next, stepId === 'implementer' ? 'implementer' : 'approval', 'error');
      break;
    case 'error':
      if (stepId) {
        setStepStatus(next, stepId, 'error');
      }
      break;
    case 'cancelled':
      for (const step of next) {
        if (step.status === 'running') {
          step.status = 'skipped';
        }
      }
      break;
  }

  return next;
}

function setStepStatus(
  timeline: PipelineTimelineStep[],
  stepId: string,
  status: PipelineTimelineStepStatus,
): void {
  const step = timeline.find(entry => entry.id === stepId);
  if (step) {
    step.status = status;
  }
}

/** Moves legacy pipeline items from chatHistory into the orchestration slice. */
export function migratePipelineFromChatHistory(
  chatHistory: ChatHistoryItem[],
  orchestration: OrchestrationSlice,
): { chatHistory: ChatHistoryItem[]; orchestration: OrchestrationSlice } {
  const hasPipelineItems = chatHistory.some(
    item => item.kind === 'pipelinePlan' || item.kind === 'pipelineRoleOutput',
  );
  if (!hasPipelineItems) {
    return { chatHistory, orchestration };
  }

  const cleanHistory = chatHistory.filter(
    item => item.kind !== 'pipelinePlan' && item.kind !== 'pipelineRoleOutput',
  );

  let plan = orchestration.plan;
  const roleOutputs = [...orchestration.roleOutputs];

  for (const item of chatHistory) {
    if (item.kind === 'pipelinePlan') {
      plan = {
        plan: item.plan,
        status: item.status,
        message: item.message,
        role: item.role,
        agentName: item.agentName,
        implementerUsesSandcastle: item.implementerUsesSandcastle,
      };
    } else if (item.kind === 'pipelineRoleOutput') {
      roleOutputs.push({
        role: item.role,
        agentName: item.agentName,
        text: item.text,
        title: item.title,
      });
    }
  }

  return {
    chatHistory: cleanHistory,
    orchestration: { ...orchestration, plan, roleOutputs },
  };
}

export type {
  PipelinePhase,
  PipelinePlanStatus,
  PipelineTimelineStep,
  PipelineTimelineStepStatus,
} from '../../../src/ui/PipelineTypes';
