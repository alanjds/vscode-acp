import type {
  ChatHistoryItem,
  CurrentTurn,
  PersistedWebviewState,
  PipelinePhase,
  SessionSnapshot,
  ToolCallHistoryItem,
  ToolCallStatus,
} from '../../chatTypes';
import type { AppState } from './types';

export const MIN_INPUT_HEIGHT = 90;
export const MAX_INPUT_HEIGHT = 400;
export const FALLBACK_TURN_ID = 'fallback-turn';

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

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function ensureSessionState(state: AppState): SessionSnapshot {
  return state.persisted.sessionState ?? { availableCommands: [] };
}

export function formatPipelineRoleLabel(role: PipelinePhase): string {
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

export function ensureCurrentTurn(state: AppState): CurrentTurn {
  return state.currentTurn ?? createCurrentTurn(FALLBACK_TURN_ID);
}

export function updateHistoryToolCall(
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

export function commitCurrentTurnToHistory(
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
