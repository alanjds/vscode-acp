export const CHAT_STATE_KEY = 'acp.chatWebviewSharedState';

export interface ChatWebviewSharedState {
  version: number;
  updatedAt: number;
  chatHistory: unknown[];
  sessionState: unknown | null;
  hasActiveSession: boolean;
  promptText: string;
  inputAreaHeight: number;
  isProcessing: boolean;
  currentTurn: unknown | null;
  collapsedTools: Record<string, boolean>;
  pipelineTimeline: unknown[];
  activePipelineRole: string | null;
  activePipelineAgentName: string | null;
  composerUnlocked?: boolean;
}

export function emptySharedState(): ChatWebviewSharedState {
  return {
    version: 0,
    updatedAt: 0,
    chatHistory: [],
    sessionState: null,
    hasActiveSession: false,
    promptText: '',
    inputAreaHeight: 140,
    isProcessing: false,
    currentTurn: null,
    collapsedTools: {},
    pipelineTimeline: [],
    activePipelineRole: null,
    activePipelineAgentName: null,
  };
}

export function normalizeSharedState(value: unknown): ChatWebviewSharedState {
  if (!value || typeof value !== 'object') {
    return emptySharedState();
  }

  const candidate = value as Partial<ChatWebviewSharedState>;
  return {
    version: typeof candidate.version === 'number' ? candidate.version : 0,
    updatedAt: typeof candidate.updatedAt === 'number' ? candidate.updatedAt : 0,
    chatHistory: Array.isArray(candidate.chatHistory) ? candidate.chatHistory : [],
    sessionState: candidate.sessionState ?? null,
    hasActiveSession: Boolean(candidate.hasActiveSession),
    promptText: typeof candidate.promptText === 'string' ? candidate.promptText : '',
    inputAreaHeight: typeof candidate.inputAreaHeight === 'number' ? candidate.inputAreaHeight : 140,
    isProcessing: Boolean(candidate.isProcessing),
    currentTurn: candidate.currentTurn ?? null,
    collapsedTools:
      candidate.collapsedTools && typeof candidate.collapsedTools === 'object'
        ? { ...candidate.collapsedTools }
        : {},
    pipelineTimeline: Array.isArray(candidate.pipelineTimeline) ? candidate.pipelineTimeline : [],
    activePipelineRole:
      typeof candidate.activePipelineRole === 'string' ? candidate.activePipelineRole : null,
    activePipelineAgentName:
      typeof candidate.activePipelineAgentName === 'string' ? candidate.activePipelineAgentName : null,
    composerUnlocked: candidate.composerUnlocked,
  };
}

export function hasChatContentFromSnapshot(snapshot: ChatWebviewSharedState): boolean {
  return (
    snapshot.chatHistory.length > 0
    || snapshot.hasActiveSession
    || snapshot.promptText.trim().length > 0
    || snapshot.isProcessing
  );
}
