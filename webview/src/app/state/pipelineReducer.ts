import type { AppState, PipelineAction } from './types';
import { formatPipelineRoleLabel } from './helpers';
import { emptyOrchestrationSlice } from './pipelineChatProjection';

const PIPELINE_ACTIONS = new Set<PipelineAction['type']>([
  'appendPipelinePlan',
  'revisePipelinePlan',
  'updatePipelinePlanStatus',
  'revertPipelinePlanApproval',
  'updatePipelineTimeline',
  'setActivePipelineRole',
  'appendPipelineRoleOutput',
  'resetPipelineTimeline',
  'finalizeTeamRoleTurn',
]);

export function isPipelineAction(action: { type: string }): action is PipelineAction {
  return PIPELINE_ACTIONS.has(action.type as PipelineAction['type']);
}

export function pipelineReducer(state: AppState, action: PipelineAction): AppState {
  switch (action.type) {
    case 'appendPipelinePlan':
      return {
        ...state,
        persisted: {
          ...state.persisted,
          chatHistory: [
            ...state.persisted.chatHistory,
            {
              kind: 'pipelinePlan',
              plan: action.plan,
              status: 'pending',
              role: action.role,
              agentName: action.agentName,
              implementerUsesSandcastle: action.implementerUsesSandcastle,
            },
          ],
        },
      };

    case 'revisePipelinePlan': {
      const nextHistory = [...state.persisted.chatHistory];
      for (let index = nextHistory.length - 1; index >= 0; index -= 1) {
        const item = nextHistory[index];
        if (item.kind === 'pipelinePlan' && item.status === 'pending') {
          nextHistory[index] = {
            ...item,
            plan: action.plan,
            role: action.role ?? item.role,
            agentName: action.agentName ?? item.agentName,
            implementerUsesSandcastle: action.implementerUsesSandcastle ?? item.implementerUsesSandcastle,
          };
          return {
            ...state,
            persisted: { ...state.persisted, chatHistory: nextHistory },
          };
        }
      }

      return {
        ...state,
        persisted: {
          ...state.persisted,
          chatHistory: [
            ...state.persisted.chatHistory,
            {
              kind: 'pipelinePlan',
              plan: action.plan,
              status: 'pending',
              role: action.role,
              agentName: action.agentName,
              implementerUsesSandcastle: action.implementerUsesSandcastle,
            },
          ],
        },
      };
    }

    case 'updatePipelineTimeline':
      return {
        ...state,
        orchestration: {
          ...state.orchestration,
          timeline: action.timeline,
        },
      };

    case 'setActivePipelineRole':
      return {
        ...state,
        orchestration: {
          ...state.orchestration,
          activeRole: action.role,
          activeAgentName: action.agentName ?? null,
        },
      };

    case 'appendPipelineRoleOutput':
      return {
        ...state,
        persisted: {
          ...state.persisted,
          chatHistory: [
            ...state.persisted.chatHistory,
            {
              kind: 'pipelineRoleOutput',
              role: action.role,
              agentName: action.agentName,
              text: action.text,
              title: action.title,
            },
          ],
        },
      };

    case 'resetPipelineTimeline':
      return {
        ...state,
        orchestration: emptyOrchestrationSlice(),
      };

    case 'finalizeTeamRoleTurn': {
      const { activeRole, activeAgentName } = state.orchestration;
      if (!activeRole || activeRole === 'planner' || !state.currentTurn?.assistantText.trim()) {
        return state;
      }

      const roleLabel = formatPipelineRoleLabel(activeRole);
      const agentSuffix = activeAgentName ? ` (${activeAgentName})` : '';

      return {
        ...state,
        persisted: {
          ...state.persisted,
          chatHistory: [
            ...state.persisted.chatHistory,
            {
              kind: 'pipelineRoleOutput' as const,
              role: activeRole,
              agentName: activeAgentName ?? undefined,
              text: state.currentTurn.assistantText,
              title: `${roleLabel}${agentSuffix}`,
            },
          ],
        },
        isProcessing: false,
        currentTurn: null,
      };
    }

    case 'updatePipelinePlanStatus': {
      const nextHistory = [...state.persisted.chatHistory];
      for (let index = nextHistory.length - 1; index >= 0; index -= 1) {
        const item = nextHistory[index];
        if (item.kind === 'pipelinePlan') {
          nextHistory[index] = {
            ...item,
            status: action.status,
            message: action.message,
          };
          break;
        }
      }
      return {
        ...state,
        persisted: { ...state.persisted, chatHistory: nextHistory },
      };
    }

    case 'revertPipelinePlanApproval': {
      const nextHistory = [...state.persisted.chatHistory];
      for (let index = nextHistory.length - 1; index >= 0; index -= 1) {
        const item = nextHistory[index];
        if (item.kind === 'pipelinePlan') {
          nextHistory[index] = {
            ...item,
            status: 'pending',
            message: undefined,
          };
          break;
        }
      }
      return {
        ...state,
        persisted: { ...state.persisted, chatHistory: nextHistory },
      };
    }

    default:
      return state;
  }
}
