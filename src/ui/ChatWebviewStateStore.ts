import * as vscode from 'vscode';

import {
  CHAT_STATE_KEY,
  ChatWebviewSharedState,
  emptySharedState,
  cloneSharedState,
  normalizeSharedState,
  patchSharedState,
  shouldAcceptIncomingSharedState,
} from './ChatWebviewSharedState';

const PERSIST_DEBOUNCE_MS = 150;

export type ChatWebviewStateChangeListener = (
  snapshot: ChatWebviewSharedState,
  sourceEndpointId?: string,
) => void;

export class ChatWebviewStateStore implements vscode.Disposable {
  private snapshot: ChatWebviewSharedState;
  private readonly listeners = new Set<ChatWebviewStateChangeListener>();
  private persistTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly workspaceState: vscode.Memento) {
    this.snapshot = normalizeSharedState(workspaceState.get(CHAT_STATE_KEY));
  }

  getSnapshot(): ChatWebviewSharedState {
    return cloneSharedState(this.snapshot);
  }

  updateFromWebview(next: ChatWebviewSharedState, sourceEndpointId: string): boolean {
    const normalized = normalizeSharedState(next);
    if (!shouldAcceptIncomingSharedState(this.snapshot, normalized)) {
      return false;
    }

    this.snapshot = normalized;
    this.schedulePersist();
    this.notify(sourceEndpointId);
    return true;
  }

  patchFromHost(patch: Partial<ChatWebviewSharedState>): void {
    this.snapshot = patchSharedState(this.snapshot, patch, Date.now());
    this.schedulePersist();
    this.notify();
  }

  hydrateFromSerializer(state: unknown): void {
    const incoming = normalizeSharedState(state);
    if (shouldAcceptIncomingSharedState(this.snapshot, incoming)) {
      this.snapshot = incoming;
      this.schedulePersist();
      this.notify();
    }
  }

  clear(): void {
    this.snapshot = emptySharedState();
    this.schedulePersist();
    this.notify();
  }

  onDidChange(listener: ChatWebviewStateChangeListener): vscode.Disposable {
    this.listeners.add(listener);
    return {
      dispose: () => {
        this.listeners.delete(listener);
      },
    };
  }

  dispose(): void {
    if (this.persistTimer) {
      clearTimeout(this.persistTimer);
      this.persistTimer = undefined;
    }
    this.flushPersist();
    this.listeners.clear();
  }

  private notify(sourceEndpointId?: string): void {
    const snapshot = this.getSnapshot();
    for (const listener of this.listeners) {
      listener(snapshot, sourceEndpointId);
    }
  }

  private schedulePersist(): void {
    if (this.persistTimer) {
      clearTimeout(this.persistTimer);
    }
    this.persistTimer = setTimeout(() => {
      this.persistTimer = undefined;
      void this.flushPersist();
    }, PERSIST_DEBOUNCE_MS);
  }

  private async flushPersist(): Promise<void> {
    await this.workspaceState.update(CHAT_STATE_KEY, this.snapshot);
  }
}
