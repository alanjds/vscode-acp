import * as assert from 'assert';

import type { AgentConfigEntry } from '../config/AgentConfig';
import { AgentManager } from '../core/AgentManager';
import { ConnectionManager } from '../core/ConnectionManager';
import { SessionUpdateHandler } from '../handlers/SessionUpdateHandler';
import { spawnAndConnectNativeAgent } from '../core/session/nativeAgentConnection';

suite('nativeAgentConnection', () => {
  const config: AgentConfigEntry = { command: 'echo' };

  test('spawn failure after connect error kills spawned agent', async () => {
    const originalSpawn = AgentManager.prototype.spawnAgent;
    const originalKill = AgentManager.prototype.killAgent;
    const originalGetAgent = AgentManager.prototype.getAgent;
    const originalConnect = ConnectionManager.prototype.connect;

    let killedAgentId: string | undefined;
    AgentManager.prototype.spawnAgent = function() {
      return { id: 'agent-1', name: 'Codex', config, process: {} as any };
    };
    AgentManager.prototype.getAgent = function() {
      return { id: 'agent-1', name: 'Codex', config, process: {} as any };
    };
    AgentManager.prototype.killAgent = function(agentId: string) {
      killedAgentId = agentId;
      return true;
    };
    ConnectionManager.prototype.connect = async function() {
      throw new Error('connect failed');
    };

    try {
      await assert.rejects(
        () => spawnAndConnectNativeAgent({
          agentManager: new AgentManager(),
          connectionManager: new ConnectionManager(new SessionUpdateHandler()),
          agentName: 'Codex',
          config,
          workspaceCwd: '/repo',
        }),
        /connect failed/,
      );
      assert.strictEqual(killedAgentId, 'agent-1');
    } finally {
      AgentManager.prototype.spawnAgent = originalSpawn;
      AgentManager.prototype.killAgent = originalKill;
      AgentManager.prototype.getAgent = originalGetAgent;
      ConnectionManager.prototype.connect = originalConnect;
    }
  });
});
