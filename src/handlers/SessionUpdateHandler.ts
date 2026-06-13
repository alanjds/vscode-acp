import { log } from '../utils/Logger';
import { DebugTraceStore } from '../core/DebugTraceStore';

import type { SessionNotification } from '@agentclientprotocol/sdk';

export type SessionUpdateListener = (update: SessionNotification) => void;

/**
 * Routes session/update notifications to registered listeners.
 * The ChatWebviewProvider registers as a listener to forward updates to the webview.
 */
export class SessionUpdateHandler {
  private listeners: Set<SessionUpdateListener> = new Set();

  constructor(private readonly debugTraceStore?: DebugTraceStore) {}

  addListener(listener: SessionUpdateListener): void {
    this.listeners.add(listener);
  }

  removeListener(listener: SessionUpdateListener): void {
    this.listeners.delete(listener);
  }

  handleUpdate(update: SessionNotification): void {
    const updateType = (update.update as any)?.sessionUpdate || 'unknown';
    log(`sessionUpdate: type=${updateType}, sessionId=${update.sessionId}`);
    this.debugTraceStore?.record({
      category: 'session-update',
      sessionId: update.sessionId,
      method: updateType,
      payload: update,
    });

    for (const listener of this.listeners) {
      try {
        listener(update);
      } catch (e) {
        log(`Error in session update listener: ${e}`);
      }
    }
  }

  dispose(): void {
    this.listeners.clear();
  }
}
