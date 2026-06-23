export const DEFAULT_INPUT_AREA_HEIGHT = 140;

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
  composerUnlocked?: boolean;
}

export interface SharedStateParts {
  chatHistory: unknown[];
  sessionState: unknown | null;
  hasActiveSession: boolean;
  promptText: string;
  inputAreaHeight: number;
  isProcessing: boolean;
  currentTurn: unknown | null;
  collapsedTools: Record<string, boolean>;
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
    inputAreaHeight: DEFAULT_INPUT_AREA_HEIGHT,
    isProcessing: false,
    currentTurn: null,
    collapsedTools: {},
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
    inputAreaHeight:
      typeof candidate.inputAreaHeight === 'number'
        ? candidate.inputAreaHeight
        : DEFAULT_INPUT_AREA_HEIGHT,
    isProcessing: Boolean(candidate.isProcessing),
    currentTurn: candidate.currentTurn ?? null,
    collapsedTools:
      candidate.collapsedTools && typeof candidate.collapsedTools === 'object'
        ? { ...candidate.collapsedTools }
        : {},
    composerUnlocked: candidate.composerUnlocked,
  };
}

export function cloneSharedState(snapshot: ChatWebviewSharedState): ChatWebviewSharedState {
  return {
    ...snapshot,
    collapsedTools: { ...snapshot.collapsedTools },
  };
}

export function patchSharedState(
  current: ChatWebviewSharedState,
  patch: Partial<ChatWebviewSharedState>,
  now: number,
): ChatWebviewSharedState {
  return normalizeSharedState({
    ...current,
    ...patch,
    version: current.version + 1,
    updatedAt: now,
  });
}

export function shouldAcceptIncomingSharedState(
  current: Pick<ChatWebviewSharedState, 'version' | 'updatedAt'>,
  incoming: Pick<ChatWebviewSharedState, 'version' | 'updatedAt'>,
): boolean {
  return incoming.version > current.version
    || (incoming.version === current.version && incoming.updatedAt > current.updatedAt);
}

export function buildSharedStateSnapshot(
  parts: SharedStateParts,
  version: number,
  updatedAt: number,
): ChatWebviewSharedState {
  return normalizeSharedState({
    version,
    updatedAt,
    ...parts,
  });
}

export function hasChatContentFromSnapshot(snapshot: ChatWebviewSharedState): boolean {
  return (
    snapshot.chatHistory.length > 0
    || snapshot.hasActiveSession
    || snapshot.promptText.trim().length > 0
    || snapshot.isProcessing
  );
}
