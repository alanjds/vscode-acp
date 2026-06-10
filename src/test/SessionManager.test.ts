import * as assert from 'assert';

import { SessionManager } from '../core/SessionManager';

function createManager() {
  const agentManager = {
    killAll: () => undefined,
  };

  const connectionManager = {
    dispose: () => undefined,
    getConnection: () => undefined,
  };

  const sessionUpdateHandler = {};

  const manager = new SessionManager(
    agentManager as any,
    connectionManager as any,
    sessionUpdateHandler as any,
  );

  const historyCalls: Array<{ agentName: string; sessionId: string; title: string | null | undefined }> = [];
  (manager as any).historyStore = {
    setTitle: (agentName: string, sessionId: string, title: string | null | undefined) => {
      historyCalls.push({ agentName, sessionId, title });
    },
    setFirstPromptIfMissing: () => undefined,
    touch: () => undefined,
  };

  return { manager, historyCalls };
}

suite('SessionManager', () => {
  test('applyConfigOptions buffers before session registration and drains later', () => {
    const { manager } = createManager();
    const options = [{ id: 'mode', category: 'mode', value: 'default' }] as any;

    manager.applyConfigOptions('s1', options);
    assert.strictEqual((manager as any).pendingConfigOptions.has('s1'), true);

    const session = {
      sessionId: 's1',
      agentName: 'Agent A',
      configOptions: null,
      availableCommands: [],
    } as any;
    (manager as any).drainPending(session);

    assert.deepStrictEqual(session.configOptions, options);
    assert.strictEqual((manager as any).pendingConfigOptions.has('s1'), false);
  });

  test('applyAvailableCommands buffers before session registration and drains later', () => {
    const { manager } = createManager();
    const commands = [{ id: 'cmd-1', title: 'Run' }] as any;

    manager.applyAvailableCommands('s1', commands);
    assert.strictEqual((manager as any).pendingAvailableCommands.has('s1'), true);

    const session = {
      sessionId: 's1',
      agentName: 'Agent A',
      configOptions: null,
      availableCommands: [],
    } as any;
    (manager as any).drainPending(session);

    assert.deepStrictEqual(session.availableCommands, commands);
    assert.strictEqual((manager as any).pendingAvailableCommands.has('s1'), false);
  });

  test('applySessionInfoUpdate patches live session title and mirrors to history store', () => {
    const { manager, historyCalls } = createManager();
    const session = {
      sessionId: 's1',
      agentName: 'Agent A',
      configOptions: null,
      availableCommands: [],
    } as any;
    (manager as any).sessions.set('s1', session);

    manager.applySessionInfoUpdate('s1', { title: 'Updated title' });

    assert.strictEqual(session.title, 'Updated title');
    assert.strictEqual(historyCalls.length, 1);
    assert.deepStrictEqual(historyCalls[0], {
      agentName: 'Agent A',
      sessionId: 's1',
      title: 'Updated title',
    });
  });

  test('applySessionInfoUpdate buffers title when session is not yet registered', () => {
    const { manager } = createManager();

    manager.applySessionInfoUpdate('s-buffered', { title: 'Buffered title' });
    assert.strictEqual((manager as any).pendingTitles.get('s-buffered'), 'Buffered title');

    const session = {
      sessionId: 's-buffered',
      agentName: 'Agent A',
      configOptions: null,
      availableCommands: [],
    } as any;

    (manager as any).drainPending(session);
    assert.strictEqual(session.title, 'Buffered title');
    assert.strictEqual((manager as any).pendingTitles.has('s-buffered'), false);
  });

  test('setMode routes to setConfigOption when mode config option exists', async () => {
    const { manager } = createManager();
    const session = {
      sessionId: 's1',
      agentName: 'Agent A',
      configOptions: [{ id: 'mode-option', category: 'mode' }],
      availableCommands: [],
    } as any;
    (manager as any).sessions.set('s1', session);

    const calls: Array<{ sessionId: string; configId: string; value: string }> = [];
    (manager as any).setConfigOption = async (sessionId: string, configId: string, value: string) => {
      calls.push({ sessionId, configId, value });
      return null;
    };

    await manager.setMode('s1', 'code');

    assert.deepStrictEqual(calls, [{ sessionId: 's1', configId: 'mode-option', value: 'code' }]);
  });

  test('setModel routes to setConfigOption when model config option exists', async () => {
    const { manager } = createManager();
    const session = {
      sessionId: 's1',
      agentName: 'Agent A',
      configOptions: [{ id: 'model-option', category: 'model' }],
      availableCommands: [],
    } as any;
    (manager as any).sessions.set('s1', session);

    const calls: Array<{ sessionId: string; configId: string; value: string }> = [];
    (manager as any).setConfigOption = async (sessionId: string, configId: string, value: string) => {
      calls.push({ sessionId, configId, value });
      return null;
    };

    await manager.setModel('s1', 'gpt-x');

    assert.deepStrictEqual(calls, [{ sessionId: 's1', configId: 'model-option', value: 'gpt-x' }]);
  });

  test('getActiveAgentName returns agent name for active session', () => {
    const { manager } = createManager();
    const session = {
      sessionId: 's1',
      agentName: 'Agent A',
      configOptions: null,
      availableCommands: [],
    } as any;

    (manager as any).sessions.set('s1', session);
    (manager as any).activeSessionId = 's1';

    assert.strictEqual(manager.getActiveAgentName(), 'Agent A');

    (manager as any).activeSessionId = null;
    assert.strictEqual(manager.getActiveAgentName(), null);
  });
});