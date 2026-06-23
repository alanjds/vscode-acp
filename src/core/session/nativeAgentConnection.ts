import type { AgentConfigEntry } from '../../config/AgentConfig';
import { isSandcastleAgentConfig } from '../../config/AgentConfig';
import { AgentManager } from '../AgentManager';
import { ConnectionInfo, ConnectionManager } from '../ConnectionManager';

export type NativeAgentSpawnConnection = {
  agentId: string;
  connInfo: ConnectionInfo;
};

/**
 * Spawn and connect a native ACP agent process for ConnectedAgent lifecycle.
 * Shared by SessionConnector.connectToAgent and ensureConnected.
 */
export async function spawnAndConnectNativeAgent(input: {
  agentManager: AgentManager;
  connectionManager: ConnectionManager;
  agentName: string;
  config: AgentConfigEntry;
  workspaceCwd: string;
}): Promise<NativeAgentSpawnConnection> {
  const { agentManager, connectionManager, agentName, config, workspaceCwd } = input;
  const agentInstance = agentManager.spawnAgent(agentName, config, workspaceCwd);
  const agentId = agentInstance.id;

  const agentProcess = agentManager.getAgent(agentId);
  if (!agentProcess) {
    throw new Error('Agent process not found after spawn');
  }

  try {
    const connInfo = await connectionManager.connect(
      agentId,
      agentProcess.process,
      workspaceCwd,
      { autoApproveAll: isSandcastleAgentConfig(config) },
    );
    return { agentId, connInfo };
  } catch (e) {
    agentManager.killAgent(agentId);
    throw e;
  }
}
