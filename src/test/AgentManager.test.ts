import * as assert from 'assert';

import { AgentManager } from '../core/AgentManager';

function makeFakeProcess() {
  const calls: string[] = [];
  return {
    process: {
      exitCode: 0,
      kill: (signal: string) => {
        calls.push(signal);
        return true;
      },
    },
    calls,
  };
}

suite('AgentManager', () => {
  test('killAgent returns false for unknown id', () => {
    const manager = new AgentManager();
    assert.strictEqual(manager.killAgent('missing'), false);
  });

  test('killAgent removes agent and sends SIGTERM', () => {
    const manager = new AgentManager();
    const fake = makeFakeProcess();

    (manager as any).agents.set('agent_1', {
      id: 'agent_1',
      name: 'Test',
      process: fake.process,
      config: { command: 'echo' },
    });

    assert.strictEqual(manager.killAgent('agent_1'), true);
    assert.deepStrictEqual(fake.calls, ['SIGTERM']);
    assert.strictEqual(manager.getAgent('agent_1'), undefined);
  });

  test('getRunningAgents reflects tracked map and killAll clears it', () => {
    const manager = new AgentManager();
    const fake1 = makeFakeProcess();
    const fake2 = makeFakeProcess();

    (manager as any).agents.set('agent_1', {
      id: 'agent_1',
      name: 'A1',
      process: fake1.process,
      config: { command: 'echo' },
    });
    (manager as any).agents.set('agent_2', {
      id: 'agent_2',
      name: 'A2',
      process: fake2.process,
      config: { command: 'echo' },
    });

    assert.strictEqual(manager.getRunningAgents().length, 2);
    manager.killAll();
    assert.strictEqual(manager.getRunningAgents().length, 0);
  });

  test('dispose clears listeners', () => {
    const manager = new AgentManager();
    const listener = () => undefined;
    manager.on('agent-error', listener);

    assert.strictEqual(manager.listenerCount('agent-error'), 1);
    manager.dispose();
    assert.strictEqual(manager.listenerCount('agent-error'), 0);
  });
});