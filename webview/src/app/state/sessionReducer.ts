import type { ChatWebviewSharedState, CurrentTurn } from '../../chatTypes';
import { normalizeSharedState } from '../../../../src/ui/ChatWebviewSharedStateCore';
import { normalizeOrchestrationState } from '../../../../src/ui/OrchestrationStateCore';
import { normalizePersistedState, normalizeSessionSnapshot } from '../normalizers';
import { emptyOrchestrationSlice } from '../OrchestrationProjector';
import type { AppState, SessionAction } from './types';
import { clamp, commitCurrentTurnToHistory, ensureSessionState, MAX_INPUT_HEIGHT, MIN_INPUT_HEIGHT } from './helpers';

const SESSION_ACTIONS = new Set<SessionAction['type']>([
  'showSessionConnected',
  'showNoSession',
  'updateModes',
  'updateModels',
  'updateConfigOptions',
  'updateSessionTitle',
  'updateCurrentMode',
  'updateCurrentModel',
  'updateAvailableCommands',
  'loadSessionStart',
  'loadSessionEnd',
  'hydrateSharedState',
  'hydrateOrchestrationState',
]);

export function isSessionAction(action: { type: string }): action is SessionAction {
  return SESSION_ACTIONS.has(action.type as SessionAction['type']);
}

export function normalizeSharedBootstrapState(value: unknown): Partial<{
  persisted: ReturnType<typeof normalizePersistedState>;
  promptText: string;
  inputAreaHeight: number;
  isProcessing: boolean;
  composerUnlocked: boolean;
  currentTurn: CurrentTurn | null;
  collapsedTools: Record<string, boolean>;
}> | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const shared = normalizeSharedState(value) as ChatWebviewSharedState;
  if (shared.version === 0 && shared.updatedAt === 0) {
    return null;
  }

  return {
    persisted: normalizePersistedState(shared),
    promptText: shared.promptText,
    inputAreaHeight: shared.inputAreaHeight,
    isProcessing: shared.isProcessing,
    composerUnlocked: shared.composerUnlocked,
    currentTurn: shared.currentTurn as CurrentTurn | null,
    collapsedTools: shared.collapsedTools,
  };
}

export function sessionReducer(state: AppState, action: SessionAction): AppState {
  switch (action.type) {
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

    case 'updateModes': {
      const sessionState = ensureSessionState(state);
      return {
        ...state,
        persisted: {
          ...state.persisted,
          sessionState: { ...sessionState, modes: action.modes },
        },
      };
    }

    case 'updateModels': {
      const sessionState = ensureSessionState(state);
      return {
        ...state,
        persisted: {
          ...state.persisted,
          sessionState: { ...sessionState, models: action.models },
        },
      };
    }

    case 'updateConfigOptions': {
      const sessionState = ensureSessionState(state);
      return {
        ...state,
        persisted: {
          ...state.persisted,
          sessionState: { ...sessionState, configOptions: action.configOptions },
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

    case 'loadSessionStart':
      return {
        ...state,
        persisted: {
          ...state.persisted,
          chatHistory: [],
        },
        orchestration: emptyOrchestrationSlice(),
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
      };

    case 'hydrateOrchestrationState':
      return {
        ...state,
        orchestration: normalizeOrchestrationState(action.state),
      };

    default:
      return state;
  }
}
