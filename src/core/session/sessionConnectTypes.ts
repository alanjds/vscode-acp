import { AgentManager } from '../AgentManager';
import { ConnectionManager } from '../ConnectionManager';
import { SessionAuthHandler } from '../SessionAuthHandler';
import { DiscussionContextHandler } from '../DiscussionContextHandler';
import { SessionState } from '../SessionState';
import { SessionUpdateBuffer } from '../SessionUpdateBuffer';
import type { WorkspaceIdentity } from '../WorkspaceIdentity';
import type { VirtualSessionRuntime } from '../VirtualSessionRuntime';

export type SessionConnectorEmitter = (
  event: string,
  ...args: any[]
) => boolean;

export interface SessionConnectorDeps {
  agentManager: AgentManager;
  connectionManager: ConnectionManager;
  sessionState: SessionState;
  updateBuffer: SessionUpdateBuffer;
  authHandler: SessionAuthHandler;
  discussionContextHandler: DiscussionContextHandler;
  getConfigs: () => Record<string, any>;
  getWorkspaceIdentity: () => WorkspaceIdentity;
  getWorkspaceCwd: () => string;
  getVirtualSessionRuntime: () => VirtualSessionRuntime | null;
  disconnectAgent: (agentName: string) => Promise<void>;
  emit: SessionConnectorEmitter;
}
