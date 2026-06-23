import * as assert from 'assert';

import type { AgentConfigEntry } from '../config/AgentConfig';
import {
  connectEphemeralAcpAgent,
  createEphemeralAcpSession,
} from '../core/AgentConnectionFactory';
import { AgentManager } from '../core/AgentManager';
import { ConnectionManager } from '../core/ConnectionManager';
import { SessionAuthHandler } from '../core/SessionAuthHandler';

suite('AgentConnectionFactory', () => {
  const config: AgentConfigEntry = { command: 'echo' };

  test('connect failure kills spawned agent', async () => {
    const originalSpawn = AgentManager.prototype.spawnAgent;
    const originalKill = AgentManager.prototype.killAgent;
    const originalConnect = ConnectionManager.prototype.connect;

    let killedAgentId: string | undefined;
    AgentManager.prototype.spawnAgent = function() {
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
        () => connectEphemeralAcpAgent({
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
      ConnectionManager.prototype.connect = originalConnect;
    }
  });

  test('createEphemeralAcpSession retries newSession after auth flow', async () => {
    let authFlowRuns = 0;
    const authHandler = {
      isAuthRequiredError: (error: unknown) => error instanceof Error && error.message === 'auth-required',
      runAuthFlow: async () => {
        authFlowRuns += 1;
      },
    } as unknown as SessionAuthHandler;

    let newSessionCalls = 0;
    const connInfo = {
      connection: {
        newSession: async () => {
          newSessionCalls += 1;
          if (newSessionCalls === 1) {
            throw new Error('auth-required');
          }
          return { sessionId: 'session-1' };
        },
      },
    } as any;

    const result = await createEphemeralAcpSession(
      'Codex',
      'agent-1',
      connInfo,
      '/repo',
      authHandler,
    );

    assert.strictEqual(result.sessionId, 'session-1');
    assert.strictEqual(newSessionCalls, 2);
    assert.strictEqual(authFlowRuns, 1);
  });
});
