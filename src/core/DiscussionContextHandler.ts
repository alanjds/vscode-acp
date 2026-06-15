import type { SessionHistoryStore, ContextFamilyInfo } from './SessionHistoryStore';
import type { SessionInfo } from './SessionManager';
import type { WorkspaceIdentity } from './WorkspaceIdentity';

/**
 * Shared discussion context between agents.
 */
export interface SharedDiscussionContext {
  text: string;
  sourceAgentName: string;
  sourceSessionId: string;
}

/**
 * Manages discussion context sharing between agent sessions and
 * the persistent history store integration.
 */
export class DiscussionContextHandler {
  private pendingSharedDiscussionContext: Map<string, string> = new Map();

  constructor(
    private historyStore: SessionHistoryStore | null,
  ) {}

  // --- Setter for late injection ---

  setHistoryStore(store: SessionHistoryStore | null): void {
    this.historyStore = store;
  }

  getHistoryStore(): SessionHistoryStore | null {
    return this.historyStore;
  }

  // --- Context Sharing ---

  hasShareableDiscussionContext(
    targetAgentName: string,
    currentSession: SessionInfo | undefined,
    targetSessionId?: string,
  ): boolean {
    if (!currentSession || !this.historyStore) {
      return false;
    }
    if (currentSession.agentName === targetAgentName && currentSession.sessionId === targetSessionId) {
      return false;
    }
    const text = this.historyStore.buildDiscussionContext(
      currentSession.agentName,
      currentSession.sessionId,
    );
    return !!text;
  }

  buildSharedDiscussionContextForTarget(
    targetAgentName: string,
    currentSession: SessionInfo | undefined,
    targetSessionId: string | undefined,
  ): SharedDiscussionContext | null {
    if (!currentSession || !this.historyStore) {
      return null;
    }
    if (currentSession.agentName === targetAgentName && currentSession.sessionId === targetSessionId) {
      return null;
    }
    const text = this.historyStore.buildDiscussionContext(
      currentSession.agentName,
      currentSession.sessionId,
    );
    return text
      ? {
          text,
          sourceAgentName: currentSession.agentName,
          sourceSessionId: currentSession.sessionId,
        }
      : null;
  }

  linkContextFamily(
    sharedDiscussionContext: SharedDiscussionContext,
    targetAgentName: string,
    targetSessionId: string,
    workspace: string | WorkspaceIdentity,
  ): ContextFamilyInfo | null {
    if (!this.historyStore) {
      return null;
    }

    this.historyStore.upsertNew(targetAgentName, workspace, targetSessionId);
    return this.historyStore.linkContextFamily(
      sharedDiscussionContext.sourceAgentName,
      sharedDiscussionContext.sourceSessionId,
      targetAgentName,
      targetSessionId,
      workspace,
    );
  }

  getSessionContextFamily(
    session: SessionInfo | undefined,
    sessionId: string,
  ): ContextFamilyInfo | null {
    if (!session || !this.historyStore) {
      return null;
    }
    return this.historyStore.getContextFamily(
      session.agentName,
      sessionId,
      session.cwd,
    );
  }

  getActiveContextFamilyId(
    session: SessionInfo | undefined,
    sessionId: string | null,
  ): string | null {
    if (!sessionId) {
      return null;
    }
    const family = this.getSessionContextFamily(session, sessionId);
    return family?.contextFamilyId ?? null;
  }

  // --- Pending Context ---

  setPending(sessionId: string, text: string): void {
    this.pendingSharedDiscussionContext.set(sessionId, text);
  }

  consumePending(sessionId: string, text: string): string {
    const sharedContext = this.pendingSharedDiscussionContext.get(sessionId);
    if (sharedContext) {
      this.pendingSharedDiscussionContext.delete(sessionId);
    }
    return sharedContext ? `${sharedContext}\n\nCurrent user prompt:\n${text}` : text;
  }

  hasPending(sessionId: string): boolean {
    return this.pendingSharedDiscussionContext.has(sessionId);
  }

  clearPending(sessionId: string): void {
    this.pendingSharedDiscussionContext.delete(sessionId);
  }

  // --- History Store Delegation ---

  recordFirstPrompt(
    session: SessionInfo | undefined,
    sessionId: string,
    prompt: string,
  ): void {
    if (!session || !this.historyStore) {
      return;
    }
    this.historyStore.setFirstPromptIfMissing(
      session.agentName,
      sessionId,
      prompt,
    );
  }

  recordUserMessage(
    session: SessionInfo | undefined,
    sessionId: string,
    text: string,
  ): void {
    if (!session || !this.historyStore) {
      return;
    }
    this.historyStore.appendUserMessage(session.agentName, sessionId, text);
  }

  recordUserMessageChunk(
    session: SessionInfo | undefined,
    sessionId: string,
    text: string,
  ): void {
    if (!session || !this.historyStore) {
      return;
    }
    this.historyStore.appendUserMessageChunk(session.agentName, sessionId, text);
  }

  recordAssistantMessageChunk(
    session: SessionInfo | undefined,
    sessionId: string,
    text: string,
  ): void {
    if (!session || !this.historyStore) {
      return;
    }
    this.historyStore.appendAssistantMessageChunk(session.agentName, sessionId, text);
  }

  touchHistory(session: SessionInfo | undefined, sessionId: string): void {
    if (!session) {
      return;
    }
    this.historyStore?.touch(session.agentName, sessionId);
  }

  // --- Cleanup ---

  dispose(): void {
    this.pendingSharedDiscussionContext.clear();
  }
}
