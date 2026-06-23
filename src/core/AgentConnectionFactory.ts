import type { AgentConfigEntry } from '../config/AgentConfig';
import { isSandcastleAgentConfig } from '../config/AgentConfig';
import { SessionUpdateHandler } from '../handlers/SessionUpdateHandler';
import { AgentManager } from './AgentManager';
import { ConnectionInfo, ConnectionManager } from './ConnectionManager';
import { SessionAuthHandler } from './SessionAuthHandler';

export interface ConnectEphemeralAcpAgentInput {
  agentName: string;
  config: AgentConfigEntry;
  workspaceCwd: string;
  sessionUpdateHandler?: SessionUpdateHandler;
}

export interface EphemeralAcpConnection {
  agentId: string;
  connInfo: ConnectionInfo;
  dispose: () => void;
}

/**
 * Shared spawn → connect cycle for ephemeral ACP runs.
 * Used by EphemeralRun and other short-lived agent paths.
 */
export async function connectEphemeralAcpAgent(
  input: ConnectEphemeralAcpAgentInput,
): Promise<EphemeralAcpConnection> {
  const { agentName, config, workspaceCwd, sessionUpdateHandler } = input;
  const agentManager = new AgentManager();
  const connectionManager = new ConnectionManager(sessionUpdateHandler ?? new SessionUpdateHandler());

  const agentInstance = agentManager.spawnAgent(agentName, config, workspaceCwd);
  const agentId = agentInstance.id;

  let connInfo: ConnectionInfo;
  try {
    connInfo = await connectionManager.connect(
      agentId,
      agentInstance.process,
      workspaceCwd,
      { autoApproveAll: isSandcastleAgentConfig(config) },
    );
  } catch (e) {
    agentManager.killAgent(agentId);
    throw e;
  }

  const dispose = (): void => {
    agentManager.killAll();
    connectionManager.dispose();
    sessionUpdateHandler?.dispose();
  };

  return { agentId, connInfo, dispose };
}

export async function createEphemeralAcpSession(
  agentName: string,
  agentId: string,
  connInfo: ConnectionInfo,
  workspaceCwd: string,
  authHandler: SessionAuthHandler,
  throwIfAborted?: () => void,
): Promise<{ sessionId: string }> {
  throwIfAborted?.();

  try {
    return await connInfo.connection.newSession({ cwd: workspaceCwd, mcpServers: [] });
  } catch (e: any) {
    if (!authHandler.isAuthRequiredError(e)) {
      throw e;
    }
    await authHandler.runAuthFlow(agentName, agentId, connInfo);
    throwIfAborted?.();
    return connInfo.connection.newSession({ cwd: workspaceCwd, mcpServers: [] });
  }
}
