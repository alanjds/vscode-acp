import type { PromptResponse } from '@agentclientprotocol/sdk';

export interface VirtualSessionDescriptor {
  sessionId: string;
  agentId: string;
  displayName: string;
}

/**
 * Runs conversations that do not use a spawned ACP process.
 * The native ACP path remains built into SessionManager; plugins register the
 * genuinely different virtual path through this seam.
 */
export interface VirtualSessionRuntime {
  canHandle(agentName: string): boolean;
  createSession(agentName: string, cwd: string): VirtualSessionDescriptor;
  sendPrompt(sessionId: string, text: string, agentName: string): Promise<PromptResponse>;
  cancel(sessionId: string): void;
  dispose(): void | Promise<void>;
}
