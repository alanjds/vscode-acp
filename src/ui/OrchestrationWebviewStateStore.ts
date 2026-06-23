import * as vscode from 'vscode';

import {
  ORCHESTRATION_STATE_KEY,
  OrchestrationState,
  cloneOrchestrationState,
  emptyOrchestrationState,
  normalizeOrchestrationState,
  shouldAcceptIncomingOrchestrationState,
} from './OrchestrationStateCore';

const PERSIST_DEBOUNCE_MS = 150;

export type OrchestrationWebviewStateChangeListener = (
  snapshot: OrchestrationState,
  sourceEndpointId?: string,
) => void;

export class OrchestrationWebviewStateStore implements vscode.Disposable {
  private snapshot: OrchestrationState;
  private readonly listeners = new Set<OrchestrationWebviewStateChangeListener>();
  private persistTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly workspaceState: vscode.Memento) {
    this.snapshot = normalizeOrchestrationState(workspaceState.get(ORCHESTRATION_STATE_KEY));
  }

  getSnapshot(): OrchestrationState {
    return cloneOrchestrationState(this.snapshot);
  }

  updateFromWebview(next: OrchestrationState, sourceEndpointId: string): boolean {
    const normalized = normalizeOrchestrationState(next);
    if (!shouldAcceptIncomingOrchestrationState(this.snapshot, normalized)) {
      return false;
    }

    this.snapshot = normalized;
    this.schedulePersist();
    this.notify(sourceEndpointId);
    return true;
  }

  hydrateFromSerializer(state: unknown): void {
    const incoming = normalizeOrchestrationState(state);
    if (shouldAcceptIncomingOrchestrationState(this.snapshot, incoming)) {
      this.snapshot = incoming;
      this.schedulePersist();
      this.notify();
    }
  }

  clear(): void {
    this.snapshot = emptyOrchestrationState();
    this.schedulePersist();
    this.notify();
  }

  onDidChange(listener: OrchestrationWebviewStateChangeListener): vscode.Disposable {
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
    await this.workspaceState.update(ORCHESTRATION_STATE_KEY, this.snapshot);
  }
}
