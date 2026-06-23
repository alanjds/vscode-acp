import type { ConnectionInfo } from '../ConnectionManager';
import type { WorkspaceIdentity } from '../WorkspaceIdentity';
import { createAcpSession } from './acpSessionFactory';
import { disconnectAgentSession } from './disconnectAgentSession';
import {
  connectNativeAgentSession,
  ensureNativeAgentConnected,
  findAgentIdForConnection,
  recordAgentConnectionFailure,
} from './nativeSessionConnect';
import type { SessionConnectorDeps } from './sessionConnectTypes';
import type { OpenSessionOptions, SessionInfo } from './sessionTypes';
import { connectVirtualSession } from './virtualSessionConnect';

export type { SessionConnectorDeps, SessionConnectorEmitter } from './sessionConnectTypes';

/**
 * Routes ConnectedAgent connect/disconnect by Transport.
 * Implementation: nativeSessionConnect (nativeAcp/sandcastle) · virtualSessionConnect (virtual).
 */
export class SessionConnector {
  constructor(private readonly deps: SessionConnectorDeps) {}

  async connectToAgent(agentName: string, options: OpenSessionOptions = {}): Promise<SessionInfo> {
    if (this.deps.getVirtualSessionRuntime()?.canHandle(agentName)) {
      return connectVirtualSession(this.deps, agentName, options);
    }
    return connectNativeAgentSession(this.deps, agentName, options);
  }

  async connectToVirtualAgent(agentName: string, options: OpenSessionOptions = {}): Promise<SessionInfo> {
    return connectVirtualSession(this.deps, agentName, options);
  }

  async disconnectAgent(agentName: string): Promise<void> {
    return disconnectAgentSession(this.deps, agentName);
  }

  async createAcpSession(
    agentName: string,
    agentId: string,
    connInfo: ConnectionInfo,
    workspace: WorkspaceIdentity,
    agentFingerprint?: string,
  ): Promise<SessionInfo> {
    return createAcpSession(this.deps, agentName, agentId, connInfo, workspace, agentFingerprint);
  }

  async ensureConnected(agentName: string): Promise<ConnectionInfo> {
    return ensureNativeAgentConnected(this.deps, agentName);
  }

  findAgentIdForConnection(conn: ConnectionInfo): string | undefined {
    return findAgentIdForConnection(this.deps, conn);
  }

  recordAgentConnectionFailure(agentName: string, error: unknown): void {
    recordAgentConnectionFailure(this.deps, agentName, error);
  }
}
