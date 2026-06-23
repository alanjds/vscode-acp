import {
  buildSharedStateSnapshot,
  DEFAULT_INPUT_AREA_HEIGHT,
  type SharedStateParts,
} from '../../../../src/ui/ChatWebviewSharedStateCore';
import {
  buildOrchestrationSnapshot,
  extractLegacyOrchestrationFromShared,
  normalizeOrchestrationState,
  normalizeWebviewSerializerState,
} from '../../../../src/ui/OrchestrationStateCore';
import type { ChatWebviewSharedState } from '../../chatTypes';
import { normalizePersistedState } from '../normalizers';
import {
  emptyOrchestrationSlice,
  migratePipelineFromChatHistory,
  type OrchestrationSlice,
} from '../OrchestrationProjector';
import { chatReducer, isChatAction } from './chatReducer';
import { composerReducer, isComposerAction } from './composerReducer';
import { emptyPersistedState } from './helpers';
import { pipelineReducer, isPipelineAction } from './pipelineReducer';
import {
  isSessionAction,
  normalizeSharedBootstrapState,
  sessionReducer,
} from './sessionReducer';
import type { AppAction, AppState } from './types';

export type { AppAction, AppState } from './types';
export {
  createCurrentTurn,
  emptyPersistedState,
  MIN_INPUT_HEIGHT,
  MAX_INPUT_HEIGHT,
} from './helpers';
export { DEFAULT_INPUT_AREA_HEIGHT as DEFAULT_INPUT_HEIGHT } from '../../../../src/ui/ChatWebviewSharedStateCore';
export { selectOrchestrationView, emptyOrchestrationSlice } from '../OrchestrationProjector';
export type { OrchestrationSlice, OrchestrationViewModel } from '../OrchestrationProjector';

export type WebviewPersistedBundle = {
  shared: ChatWebviewSharedState;
  orchestration: OrchestrationSlice;
};

export function buildSharedSnapshot(state: AppState, version: number, updatedAt: number): ChatWebviewSharedState {
  const parts: SharedStateParts = {
    chatHistory: state.persisted.chatHistory,
    sessionState: state.persisted.sessionState,
    hasActiveSession: state.persisted.hasActiveSession,
    promptText: state.promptText,
    inputAreaHeight: state.inputAreaHeight,
    isProcessing: state.isProcessing,
    currentTurn: state.currentTurn,
    collapsedTools: state.collapsedTools,
    composerUnlocked: state.composerUnlocked,
  };
  return buildSharedStateSnapshot(parts, version, updatedAt) as ChatWebviewSharedState;
}

export function buildWebviewPersistedBundle(
  state: AppState,
  sharedVersion: number,
  sharedUpdatedAt: number,
  orchestrationVersion = state.orchestration.version,
  orchestrationUpdatedAt = state.orchestration.updatedAt,
): WebviewPersistedBundle {
  return {
    shared: buildSharedSnapshot(state, sharedVersion, sharedUpdatedAt),
    orchestration: buildOrchestrationSnapshot(
      {
        timeline: state.orchestration.timeline,
        activeRole: state.orchestration.activeRole,
        activeAgentName: state.orchestration.activeAgentName,
        plan: state.orchestration.plan,
        roleOutputs: state.orchestration.roleOutputs,
      },
      orchestrationVersion,
      orchestrationUpdatedAt,
    ),
  };
}

export function createInitialState(persistedValue: unknown): AppState {
  const wrapper = normalizeWebviewSerializerState(persistedValue);
  const sharedSource = wrapper.shared ?? persistedValue;
  const shared = normalizeSharedBootstrapState(sharedSource);
  const orchestration = wrapper.orchestration
    ? normalizeOrchestrationState(wrapper.orchestration)
    : extractLegacyOrchestrationFromShared(persistedValue);
  const persistedRaw = shared?.persisted ?? normalizePersistedState(sharedSource);
  const migrated = migratePipelineFromChatHistory(persistedRaw.chatHistory, orchestration);
  const persisted = { ...persistedRaw, chatHistory: migrated.chatHistory };
  return {
    persisted,
    orchestration: migrated.orchestration,
    promptText: shared?.promptText ?? '',
    inputAreaHeight: shared?.inputAreaHeight ?? DEFAULT_INPUT_AREA_HEIGHT,
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
  };
}

export function appReducer(state: AppState, action: AppAction): AppState {
  if (action.type === 'clearChat') {
    return {
      ...state,
      persisted: emptyPersistedState(),
      orchestration: emptyOrchestrationSlice(),
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
      promptText: '',
    };
  }

  if (isComposerAction(action)) {
    return composerReducer(state, action);
  }
  if (isSessionAction(action)) {
    return sessionReducer(state, action);
  }
  if (isChatAction(action)) {
    return chatReducer(state, action);
  }
  if (isPipelineAction(action)) {
    return pipelineReducer(state, action);
  }

  return state;
}
