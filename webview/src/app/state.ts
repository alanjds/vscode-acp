import type {
  ChatHistoryItem,
  ChatWebviewSharedState,
  CurrentTurn,
  ModelsState,
  ModesState,
  PersistedWebviewState,
  PipelinePlanStatus,
  PipelinePhase,
  PipelineTimelineStep,
  PlanUpdate,
  SessionConfigOption,
  SessionSnapshot,
  SlashCommand,
  ToolCallHistoryItem,
  ToolCallStatus,
} from '../chatTypes';
import {
  normalizePersistedState,
  normalizePlanUpdate,
  normalizeSessionSnapshot,
} from './normalizers';

export const MIN_INPUT_HEIGHT = 90;
export const MAX_INPUT_HEIGHT = 400;
export const DEFAULT_INPUT_HEIGHT = 140;
const FALLBACK_TURN_ID = 'fallback-turn';

export type AppState = {
  persisted: PersistedWebviewState;
  promptText: string;
  inputAreaHeight: number;
  isProcessing: boolean;
  composerUnlocked: boolean;
  isModeDropdownOpen: boolean;
  isModelDropdownOpen: boolean;
  openConfigDropdownId: string | null;
  slashSelectedIdx: number;
  slashPopupSuppressedFor: string | null;
  placeholderOverride: string | null;
  renderedMarkdown: Record<number, string>;
  currentTurn: CurrentTurn | null;
  collapsedTools: Record<string, boolean>;
  isLoadingSession: boolean;
  pipelineTimeline: PipelineTimelineStep[];
  activePipelineRole: PipelinePhase | null;
  activePipelineAgentName: string | null;
};

export type AppAction =
  | { type: 'setPromptText'; text: string }
  | { type: 'setInputAreaHeight'; height: number }
  | { type: 'toggleModeDropdown' }
  | { type: 'toggleModelDropdown' }
  | { type: 'toggleConfigDropdown'; configId: string }
  | { type: 'closePickers' }
  | { type: 'setSlashSelectedIdx'; index: number }
  | { type: 'suppressSlashPopup'; promptText: string | null }
  | { type: 'setPlaceholderOverride'; placeholder: string | null }
  | { type: 'setCollapsedTools'; key: string; collapsed: boolean }
  | { type: 'showSessionConnected'; session: SessionSnapshot }
  | { type: 'showNoSession' }
  | { type: 'appendUserMessage'; text: string }
  | { type: 'appendUserChunk'; text: string }
  | { type: 'appendErrorMessage'; text: string }
  | { type: 'appendInfoMessage'; text: string }
  | { type: 'promptStart'; turnId: string }
  | { type: 'promptEnd' }
  | { type: 'clearChat' }
  | { type: 'updateModes'; modes: ModesState }
  | { type: 'updateModels'; models: ModelsState }
  | { type: 'updateConfigOptions'; configOptions: SessionConfigOption[] }
  | { type: 'updateSessionTitle'; title: string | null }
  | { type: 'updateCurrentMode'; modeId: string | null }
  | { type: 'updateCurrentModel'; modelId: string | null }
  | { type: 'updateAvailableCommands'; commands: SlashCommand[] }
  | { type: 'appendThoughtChunk'; text: string }
  | { type: 'setCurrentThoughtOpen'; isOpen: boolean }
  | { type: 'appendAssistantChunk'; text: string }
  | { type: 'appendPlanningDraftChunk'; text: string }
  | { type: 'appendToolCall'; toolCallId: string; title: string; status: ToolCallStatus }
  | { type: 'updateToolCall'; toolCallId: string; title?: string; status: ToolCallStatus }
  | { type: 'appendPlan'; plan: PlanUpdate }
  | { type: 'appendPipelinePlan'; plan: string; role?: PipelinePhase; agentName?: string; implementerUsesSandcastle?: boolean }
  | { type: 'updatePipelinePlanStatus'; status: PipelinePlanStatus; message?: string }
  | { type: 'updatePipelineTimeline'; timeline: PipelineTimelineStep[] }
  | { type: 'setActivePipelineRole'; role: PipelinePhase | null; agentName?: string | null }
  | { type: 'appendPipelineRoleOutput'; role: PipelinePhase; agentName?: string; text: string; title: string }
  | { type: 'resetPipelineTimeline' }
  | { type: 'loadSessionStart' }
  | { type: 'loadSessionEnd'; ok: boolean }
  | { type: 'setRenderedMarkdown'; items: Array<{ index: number; html: string }> }
  | { type: 'hydrateSharedState'; state: ChatWebviewSharedState };

export function emptyPersistedState(): PersistedWebviewState {
  return {
    chatHistory: [],
    sessionState: null,
    hasActiveSession: false,
  };
}

export function createCurrentTurn(turnId: string): CurrentTurn {
  return {
    turnId,
    assistantText: '',
    planningDraft: '',
    thought: null,
    toolCalls: [],
    historyToolCallIndexes: [],
  };
}

export function buildSharedSnapshot(state: AppState, version: number, updatedAt: number): ChatWebviewSharedState {
  return {
    version,
    updatedAt,
    chatHistory: state.persisted.chatHistory,
    sessionState: state.persisted.sessionState,
    hasActiveSession: state.persisted.hasActiveSession,
    promptText: state.promptText,
    inputAreaHeight: state.inputAreaHeight,
    isProcessing: state.isProcessing,
    currentTurn: state.currentTurn,
    collapsedTools: state.collapsedTools,
    pipelineTimeline: state.pipelineTimeline,
    activePipelineRole: state.activePipelineRole,
    activePipelineAgentName: state.activePipelineAgentName,
    composerUnlocked: state.composerUnlocked,
  };
}

export function createInitialState(persistedValue: unknown): AppState {
  const shared = normalizeSharedBootstrapState(persistedValue);
  const persisted = shared?.persisted ?? normalizePersistedState(persistedValue);
  return {
    persisted,
    promptText: shared?.promptText ?? '',
    inputAreaHeight: shared?.inputAreaHeight ?? DEFAULT_INPUT_HEIGHT,
    isProcessing: shared?.isProcessing ?? false,
    composerUnlocked: shared?.composerUnlocked ?? persisted.hasActiveSession,
    isModeDropdownOpen: false,
    isModelDropdownOpen: false,
    openConfigDropdownId: null,
    slashSelectedIdx: 0,
    slashPopupSuppressedFor: null,
    placeholderOverride: null,
    renderedMarkdown: {},
    currentTurn: shared?.currentTurn ?? null,
    collapsedTools: shared?.collapsedTools ?? {},
    isLoadingSession: false,
    pipelineTimeline: shared?.pipelineTimeline ?? [],
    activePipelineRole: shared?.activePipelineRole ?? null,
    activePipelineAgentName: shared?.activePipelineAgentName ?? null,
  };
}

function normalizeSharedBootstrapState(value: unknown): Partial<{
  persisted: PersistedWebviewState;
  promptText: string;
  inputAreaHeight: number;
  isProcessing: boolean;
  composerUnlocked: boolean;
  currentTurn: CurrentTurn | null;
  collapsedTools: Record<string, boolean>;
  pipelineTimeline: PipelineTimelineStep[];
  activePipelineRole: PipelinePhase | null;
  activePipelineAgentName: string | null;
}> | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const candidate = value as Partial<ChatWebviewSharedState>;
  if (typeof candidate.version !== 'number' && typeof candidate.updatedAt !== 'number') {
    return null;
  }

  return {
    persisted: normalizePersistedState(candidate),
    promptText: typeof candidate.promptText === 'string' ? candidate.promptText : '',
    inputAreaHeight: typeof candidate.inputAreaHeight === 'number' ? candidate.inputAreaHeight : DEFAULT_INPUT_HEIGHT,
    isProcessing: Boolean(candidate.isProcessing),
    composerUnlocked: candidate.composerUnlocked,
    currentTurn: candidate.currentTurn ?? null,
    collapsedTools: candidate.collapsedTools ?? {},
    pipelineTimeline: Array.isArray(candidate.pipelineTimeline) ? candidate.pipelineTimeline : [],
    activePipelineRole: candidate.activePipelineRole ?? null,
    activePipelineAgentName: candidate.activePipelineAgentName ?? null,
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function ensureSessionState(state: AppState): SessionSnapshot {
  return state.persisted.sessionState ?? { availableCommands: [] };
}

function formatPipelineRoleLabel(role: PipelinePhase): string {
  switch (role) {
    case 'planner':
      return 'Planner';
    case 'implementer':
      return 'Implementer';
    case 'reviewer':
      return 'Reviewer';
    case 'tester':
      return 'Tester';
    case 'reviewer-rerun':
      return 'Review (rerun)';
  }
}

function ensureCurrentTurn(state: AppState): CurrentTurn {
  return state.currentTurn ?? createCurrentTurn(FALLBACK_TURN_ID);
}

function updateHistoryToolCall(
  chatHistory: ChatHistoryItem[],
  toolCallId: string,
  status: ToolCallStatus,
  title?: string,
): ChatHistoryItem[] {
  for (let index = chatHistory.length - 1; index >= 0; index -= 1) {
    const item = chatHistory[index];
    if (item.kind === 'toolCall' && item.toolCallId === toolCallId) {
      const nextItem: ToolCallHistoryItem = {
        ...item,
        status,
        title: title ?? item.title,
      };
      return [
        ...chatHistory.slice(0, index),
        nextItem,
        ...chatHistory.slice(index + 1),
      ];
    }
  }

  return chatHistory;
}

function commitCurrentTurnToHistory(
  chatHistory: ChatHistoryItem[],
  currentTurn: CurrentTurn | null,
): ChatHistoryItem[] {
  if (!currentTurn) {
    return chatHistory;
  }

  const nextHistory = [...chatHistory];
  if (currentTurn.thought?.text) {
    const endTime = currentTurn.thought.finishedAt ?? Date.now();
    const durationSec = currentTurn.thought.startedAt
      ? Math.round((endTime - currentTurn.thought.startedAt) / 1000)
      : 0;
    nextHistory.push({
      kind: 'thought',
      text: currentTurn.thought.text,
      durationSec,
      turnId: currentTurn.turnId,
    });
  }

  if (currentTurn.assistantText) {
    nextHistory.push({
      kind: 'message',
      role: 'assistant',
      text: currentTurn.assistantText,
      turnId: currentTurn.turnId,
    });
  }

  return nextHistory;
}

export function appReducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case 'setPromptText':
      return {
        ...state,
        promptText: action.text,
      };

    case 'setInputAreaHeight':
      return {
        ...state,
        inputAreaHeight: clamp(action.height, MIN_INPUT_HEIGHT, MAX_INPUT_HEIGHT),
      };

    case 'toggleModeDropdown':
      return {
        ...state,
        isModeDropdownOpen: !state.isModeDropdownOpen,
        isModelDropdownOpen: false,
        openConfigDropdownId: null,
      };

    case 'toggleModelDropdown':
      return {
        ...state,
        isModeDropdownOpen: false,
        isModelDropdownOpen: !state.isModelDropdownOpen,
        openConfigDropdownId: null,
      };

    case 'toggleConfigDropdown':
      return {
        ...state,
        isModeDropdownOpen: false,
        isModelDropdownOpen: false,
        openConfigDropdownId:
          state.openConfigDropdownId === action.configId ? null : action.configId,
      };

    case 'closePickers':
      return {
        ...state,
        isModeDropdownOpen: false,
        isModelDropdownOpen: false,
        openConfigDropdownId: null,
      };

    case 'setSlashSelectedIdx':
      return {
        ...state,
        slashSelectedIdx: action.index,
      };

    case 'suppressSlashPopup':
      return {
        ...state,
        slashPopupSuppressedFor: action.promptText,
      };

    case 'setPlaceholderOverride':
      return {
        ...state,
        placeholderOverride: action.placeholder,
      };

    case 'setCollapsedTools':
      return {
        ...state,
        collapsedTools: {
          ...state.collapsedTools,
          [action.key]: action.collapsed,
        },
      };

    case 'showSessionConnected':
      return {
        ...state,
        persisted: {
          ...state.persisted,
          hasActiveSession: true,
          sessionState: normalizeSessionSnapshot(action.session) ?? action.session,
        },
        composerUnlocked: true,
        isLoadingSession: false,
      };

    case 'showNoSession':
      return {
        ...state,
        persisted: {
          ...state.persisted,
          hasActiveSession: false,
          sessionState: null,
        },
        composerUnlocked: false,
        isModeDropdownOpen: false,
        isModelDropdownOpen: false,
        openConfigDropdownId: null,
        isLoadingSession: false,
      };

    case 'appendUserMessage':
      return {
        ...state,
        persisted: {
          ...state.persisted,
          chatHistory: [
            ...state.persisted.chatHistory,
            { kind: 'message', role: 'user', text: action.text },
          ],
        },
      };

    case 'appendUserChunk': {
      const nextHistory = commitCurrentTurnToHistory(
        state.persisted.chatHistory,
        state.currentTurn,
      );
      const last = nextHistory[nextHistory.length - 1];
      const chatHistory: ChatHistoryItem[] =
        last?.kind === 'message' && last.role === 'user'
          ? [
              ...nextHistory.slice(0, -1),
              {
                ...last,
                text: last.text + action.text,
              },
            ]
          : [
              ...nextHistory,
              { kind: 'message' as const, role: 'user' as const, text: action.text },
            ];

      return {
        ...state,
        persisted: {
          ...state.persisted,
          chatHistory,
        },
        currentTurn: null,
      };
    }

    case 'appendErrorMessage':
      return {
        ...state,
        persisted: {
          ...state.persisted,
          chatHistory: [
            ...state.persisted.chatHistory,
            { kind: 'message', role: 'error', text: action.text },
          ],
        },
      };

    case 'appendInfoMessage':
      return {
        ...state,
        persisted: {
          ...state.persisted,
          chatHistory: [
            ...state.persisted.chatHistory,
            { kind: 'message', role: 'info', text: action.text },
          ],
        },
      };

    case 'promptStart':
      return {
        ...state,
        isProcessing: true,
        currentTurn: createCurrentTurn(action.turnId),
        slashPopupSuppressedFor: null,
      };

    case 'promptEnd': {
      const isTeamRoleOutput = Boolean(
        state.activePipelineRole
        && state.activePipelineRole !== 'planner'
        && state.currentTurn?.assistantText.trim(),
      );

      let nextHistory = isTeamRoleOutput
        ? state.persisted.chatHistory
        : commitCurrentTurnToHistory(
          state.persisted.chatHistory,
          state.currentTurn,
        );

      if (isTeamRoleOutput && state.activePipelineRole && state.currentTurn) {
        const roleLabel = formatPipelineRoleLabel(state.activePipelineRole);
        const agentSuffix = state.activePipelineAgentName ? ` (${state.activePipelineAgentName})` : '';
        nextHistory = [
          ...nextHistory,
          {
            kind: 'pipelineRoleOutput' as const,
            role: state.activePipelineRole,
            agentName: state.activePipelineAgentName ?? undefined,
            text: state.currentTurn.assistantText,
            title: `${roleLabel}${agentSuffix}`,
          },
        ];
      }

      return {
        ...state,
        persisted: {
          ...state.persisted,
          chatHistory: nextHistory,
        },
        isProcessing: false,
        currentTurn: null,
      };
    }

    case 'clearChat':
      return {
        ...state,
        persisted: emptyPersistedState(),
        isProcessing: false,
        composerUnlocked: false,
        isModeDropdownOpen: false,
        isModelDropdownOpen: false,
        openConfigDropdownId: null,
        slashPopupSuppressedFor: null,
        placeholderOverride: null,
        renderedMarkdown: {},
        currentTurn: null,
        isLoadingSession: false,
        pipelineTimeline: [],
        activePipelineRole: null,
        activePipelineAgentName: null,
      };

    case 'updateModes': {
      const sessionState = ensureSessionState(state);
      return {
        ...state,
        persisted: {
          ...state.persisted,
          sessionState: {
            ...sessionState,
            modes: action.modes,
          },
        },
      };
    }

    case 'updateModels': {
      const sessionState = ensureSessionState(state);
      return {
        ...state,
        persisted: {
          ...state.persisted,
          sessionState: {
            ...sessionState,
            models: action.models,
          },
        },
      };
    }

    case 'updateConfigOptions': {
      const sessionState = ensureSessionState(state);
      return {
        ...state,
        persisted: {
          ...state.persisted,
          sessionState: {
            ...sessionState,
            configOptions: action.configOptions,
          },
        },
      };
    }

    case 'updateSessionTitle': {
      const sessionState = ensureSessionState(state);
      return {
        ...state,
        persisted: {
          ...state.persisted,
          sessionState: {
            ...sessionState,
            title: action.title ?? undefined,
          },
        },
      };
    }

    case 'updateCurrentMode': {
      const sessionState = ensureSessionState(state);
      return {
        ...state,
        persisted: {
          ...state.persisted,
          sessionState: {
            ...sessionState,
            modes: {
              ...(sessionState.modes ?? { availableModes: [] }),
              currentModeId: action.modeId,
            },
          },
        },
      };
    }

    case 'updateCurrentModel': {
      const sessionState = ensureSessionState(state);
      return {
        ...state,
        persisted: {
          ...state.persisted,
          sessionState: {
            ...sessionState,
            models: {
              ...(sessionState.models ?? { availableModels: [] }),
              currentModelId: action.modelId,
            },
          },
        },
      };
    }

    case 'updateAvailableCommands': {
      const sessionState = ensureSessionState(state);
      return {
        ...state,
        persisted: {
          ...state.persisted,
          sessionState: {
            ...sessionState,
            availableCommands: action.commands,
          },
        },
      };
    }

    case 'appendThoughtChunk': {
      const currentTurn = ensureCurrentTurn(state);
      return {
        ...state,
        currentTurn: {
          ...currentTurn,
          thought: currentTurn.thought
            ? {
                ...currentTurn.thought,
                text: currentTurn.thought.text + action.text,
              }
            : {
                text: action.text,
                startedAt: Date.now(),
                finishedAt: null,
                isOpen: true,
              },
        },
      };
    }

    case 'setCurrentThoughtOpen':
      if (!state.currentTurn?.thought) {
        return state;
      }

      return {
        ...state,
        currentTurn: {
          ...state.currentTurn,
          thought: {
            ...state.currentTurn.thought,
            isOpen: action.isOpen,
          },
        },
      };

    case 'appendAssistantChunk': {
      const currentTurn = ensureCurrentTurn(state);
      const assistantText = currentTurn.assistantText + action.text;
      const shouldCloseThought = assistantText.trim().length > 0 && currentTurn.thought;
      return {
        ...state,
        currentTurn: {
          ...currentTurn,
          assistantText,
          thought:
            currentTurn.thought && shouldCloseThought
              ? {
                  ...currentTurn.thought,
                  finishedAt: currentTurn.thought.finishedAt ?? Date.now(),
                  isOpen: false,
                }
              : currentTurn.thought,
        },
      };
    }

    case 'appendPlanningDraftChunk': {
      const currentTurn = ensureCurrentTurn(state);
      return {
        ...state,
        currentTurn: {
          ...currentTurn,
          planningDraft: currentTurn.planningDraft + action.text,
        },
      };
    }

    case 'appendToolCall': {
      const currentTurn = ensureCurrentTurn(state);
      const historyIndex = state.persisted.chatHistory.length;
      return {
        ...state,
        persisted: {
          ...state.persisted,
          chatHistory: [
            ...state.persisted.chatHistory,
            {
              kind: 'toolCall',
              toolCallId: action.toolCallId,
              title: action.title,
              status: action.status,
              turnId: currentTurn.turnId,
            },
          ],
        },
        currentTurn: {
          ...currentTurn,
          toolCalls: [
            ...currentTurn.toolCalls,
            {
              toolCallId: action.toolCallId,
              title: action.title,
              status: action.status,
            },
          ],
          historyToolCallIndexes: [...currentTurn.historyToolCallIndexes, historyIndex],
        },
      };
    }

    case 'updateToolCall': {
      const nextHistory = updateHistoryToolCall(
        state.persisted.chatHistory,
        action.toolCallId,
        action.status,
        action.title,
      );
      const nextTurn = state.currentTurn
        ? {
            ...state.currentTurn,
            toolCalls: state.currentTurn.toolCalls.map((toolCall) =>
              toolCall.toolCallId === action.toolCallId
                ? {
                    ...toolCall,
                    status: action.status,
                    title: action.title ?? toolCall.title,
                  }
                : toolCall,
            ),
          }
        : null;

      return {
        ...state,
        persisted: {
          ...state.persisted,
          chatHistory: nextHistory,
        },
        currentTurn: nextTurn,
      };
    }

    case 'appendPlan':
      return {
        ...state,
        persisted: {
          ...state.persisted,
          chatHistory: [
            ...state.persisted.chatHistory,
            {
              kind: 'plan',
              plan: normalizePlanUpdate(action.plan),
            },
          ],
        },
      };

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

    case 'updatePipelineTimeline':
      return {
        ...state,
        pipelineTimeline: action.timeline,
      };

    case 'setActivePipelineRole':
      return {
        ...state,
        activePipelineRole: action.role,
        activePipelineAgentName: action.agentName ?? null,
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
        pipelineTimeline: [],
        activePipelineRole: null,
        activePipelineAgentName: null,
      };

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
        persisted: {
          ...state.persisted,
          chatHistory: nextHistory,
        },
      };
    }

    case 'setRenderedMarkdown': {
      const renderedMarkdown = { ...state.renderedMarkdown };
      for (const item of action.items) {
        renderedMarkdown[item.index] = item.html;
      }
      return {
        ...state,
        renderedMarkdown,
      };
    }

    case 'loadSessionStart':
      return {
        ...state,
        persisted: {
          ...state.persisted,
          chatHistory: [],
        },
        renderedMarkdown: {},
        currentTurn: null,
        isProcessing: false,
        isLoadingSession: true,
        composerUnlocked: false,
      };

    case 'loadSessionEnd': {
      const nextHistory = commitCurrentTurnToHistory(
        state.persisted.chatHistory,
        state.currentTurn,
      );
      return {
        ...state,
        persisted: {
          ...state.persisted,
          chatHistory: action.ok
            ? nextHistory
            : [
                ...nextHistory,
                {
                  kind: 'message',
                  role: 'error',
                  text: 'Failed to load session history.',
                },
              ],
        },
        currentTurn: null,
        isLoadingSession: false,
        isProcessing: false,
        composerUnlocked: state.persisted.hasActiveSession,
      };
    }

    case 'hydrateSharedState':
      return {
        ...state,
        persisted: {
          chatHistory: action.state.chatHistory,
          sessionState: action.state.sessionState,
          hasActiveSession: action.state.hasActiveSession,
        },
        promptText: action.state.promptText,
        inputAreaHeight: clamp(action.state.inputAreaHeight, MIN_INPUT_HEIGHT, MAX_INPUT_HEIGHT),
        isProcessing: action.state.isProcessing,
        composerUnlocked: action.state.composerUnlocked ?? action.state.hasActiveSession,
        currentTurn: action.state.currentTurn,
        collapsedTools: action.state.collapsedTools,
        pipelineTimeline: action.state.pipelineTimeline,
        activePipelineRole: action.state.activePipelineRole,
        activePipelineAgentName: action.state.activePipelineAgentName,
      };

    default:
      return state;
  }
}
