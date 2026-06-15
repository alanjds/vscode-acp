import type { AvailableCommand, SessionConfigOption } from '@agentclientprotocol/sdk';
import type { SessionInfo } from './SessionManager';

/**
 * Buffers session update payloads that arrive before the corresponding
 * session is registered. This closes the microtask race between
 * newSession resolution and async notification dispatch.
 */
export class SessionUpdateBuffer {
  private pendingAvailableCommands: Map<string, AvailableCommand[]> = new Map();
  private pendingConfigOptions: Map<string, SessionConfigOption[]> = new Map();
  private pendingTitles: Map<string, string> = new Map();

  // --- Buffer Methods ---

  bufferAvailableCommands(sessionId: string, commands: AvailableCommand[]): void {
    this.pendingAvailableCommands.set(sessionId, commands);
  }

  bufferConfigOptions(sessionId: string, options: SessionConfigOption[]): void {
    this.pendingConfigOptions.set(sessionId, options);
  }

  bufferTitle(sessionId: string, title: string): void {
    this.pendingTitles.set(sessionId, title);
  }

  // --- Drain Methods ---

  /**
   * Apply buffered updates to a newly registered session.
   */
  drainInto(sessionInfo: SessionInfo): void {
    const cmds = this.pendingAvailableCommands.get(sessionInfo.sessionId);
    if (cmds) {
      sessionInfo.availableCommands = cmds;
      this.pendingAvailableCommands.delete(sessionInfo.sessionId);
    }
    const cfg = this.pendingConfigOptions.get(sessionInfo.sessionId);
    if (cfg !== undefined) {
      sessionInfo.configOptions = cfg;
      this.pendingConfigOptions.delete(sessionInfo.sessionId);
    }
    const title = this.pendingTitles.get(sessionInfo.sessionId);
    if (title !== undefined) {
      sessionInfo.title = title;
      this.pendingTitles.delete(sessionInfo.sessionId);
    }
  }

  // --- Getters for race handling ---

  getPendingAvailableCommands(sessionId: string): AvailableCommand[] | undefined {
    return this.pendingAvailableCommands.get(sessionId);
  }

  getPendingConfigOptions(sessionId: string): SessionConfigOption[] | undefined {
    return this.pendingConfigOptions.get(sessionId);
  }

  getPendingTitle(sessionId: string): string | undefined {
    return this.pendingTitles.get(sessionId);
  }

  // --- Cleanup ---

  clear(): void {
    this.pendingAvailableCommands.clear();
    this.pendingConfigOptions.clear();
    this.pendingTitles.clear();
  }
}
