import type { AppState, ComposerAction } from './types';
import { clamp, MAX_INPUT_HEIGHT, MIN_INPUT_HEIGHT } from './helpers';

const COMPOSER_ACTIONS = new Set<ComposerAction['type']>([
  'setPromptText',
  'setInputAreaHeight',
  'toggleModeDropdown',
  'toggleModelDropdown',
  'toggleConfigDropdown',
  'closePickers',
  'setSlashSelectedIdx',
  'suppressSlashPopup',
  'setPlaceholderOverride',
  'setCollapsedTools',
]);

export function isComposerAction(action: { type: string }): action is ComposerAction {
  return COMPOSER_ACTIONS.has(action.type as ComposerAction['type']);
}

export function composerReducer(state: AppState, action: ComposerAction): AppState {
  switch (action.type) {
    case 'setPromptText':
      return { ...state, promptText: action.text };

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
      return { ...state, slashSelectedIdx: action.index };

    case 'suppressSlashPopup':
      return { ...state, slashPopupSuppressedFor: action.promptText };

    case 'setPlaceholderOverride':
      return { ...state, placeholderOverride: action.placeholder };

    case 'setCollapsedTools':
      return {
        ...state,
        collapsedTools: {
          ...state.collapsedTools,
          [action.key]: action.collapsed,
        },
      };

    default:
      return state;
  }
}
