import type { ChatHistoryItem } from '../../chatTypes';
import { normalizePlanUpdate } from '../normalizers';
import type { AppState, ChatAction } from './types';
import {
  commitCurrentTurnToHistory,
  createCurrentTurn,
  ensureCurrentTurn,
  updateHistoryToolCall,
} from './helpers';

const CHAT_ACTIONS = new Set<ChatAction['type']>([
  'appendUserMessage',
  'submitUserMessage',
  'appendUserChunk',
  'appendErrorMessage',
  'appendInfoMessage',
  'promptStart',
  'promptEnd',
  'appendThoughtChunk',
  'setCurrentThoughtOpen',
  'appendAssistantChunk',
  'appendPlanningDraftChunk',
  'appendToolCall',
  'updateToolCall',
  'appendPlan',
  'setRenderedMarkdown',
]);

export function isChatAction(action: { type: string }): action is ChatAction {
  return CHAT_ACTIONS.has(action.type as ChatAction['type']);
}

export function chatReducer(state: AppState, action: ChatAction): AppState {
  switch (action.type) {
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

    case 'submitUserMessage':
      return {
        ...state,
        promptText: '',
        placeholderOverride: null,
        slashPopupSuppressedFor: null,
        isProcessing: true,
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
      if (last?.kind === 'message' && last.role === 'user' && last.text === action.text) {
        return { ...state, currentTurn: null };
      }

      const chatHistory: ChatHistoryItem[] =
        last?.kind === 'message' && last.role === 'user'
          ? [
              ...nextHistory.slice(0, -1),
              { ...last, text: last.text + action.text },
            ]
          : [
              ...nextHistory,
              { kind: 'message' as const, role: 'user' as const, text: action.text },
            ];

      return {
        ...state,
        persisted: { ...state.persisted, chatHistory },
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

    case 'promptEnd':
      return {
        ...state,
        persisted: {
          ...state.persisted,
          chatHistory: commitCurrentTurnToHistory(state.persisted.chatHistory, state.currentTurn),
        },
        isProcessing: false,
        currentTurn: null,
      };

    case 'appendThoughtChunk': {
      const currentTurn = ensureCurrentTurn(state);
      return {
        ...state,
        currentTurn: {
          ...currentTurn,
          thought: currentTurn.thought
            ? { ...currentTurn.thought, text: currentTurn.thought.text + action.text }
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
          thought: { ...state.currentTurn.thought, isOpen: action.isOpen },
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
        persisted: { ...state.persisted, chatHistory: nextHistory },
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
            { kind: 'plan', plan: normalizePlanUpdate(action.plan) },
          ],
        },
      };

    case 'setRenderedMarkdown': {
      const renderedMarkdown = { ...state.renderedMarkdown };
      for (const item of action.items) {
        renderedMarkdown[item.index] = item.html;
      }
      return { ...state, renderedMarkdown };
    }

    default:
      return state;
  }
}
