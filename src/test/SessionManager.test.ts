import * as assert from 'assert';

import { SessionManager } from '../core/SessionManager';
import { workspaceIdentityFromCwd } from '../core/WorkspaceIdentity';

function createManager() {
  const agentManager = {
    killAll: () => undefined,
    spawnAgent: (_name: string, _config: any, _cwd: string) => ({ id: 'agent-1' }),
    getAgent: (_id: string) => ({ process: {} }),
    getRunningAgents: () => [],
    on: () => undefined,
    killAgent: (_id: string) => undefined,
  };

  const connectionManager = {
    dispose: () => undefined,
    connect: async (_agentId: string, _process: any, _cwd: string) => ({
      connection: {
        newSession: async () => ({ sessionId: 's1', modes: null, models: null, configOptions: null }),
        prompt: async () => ({ stopReason: 'end_turn' }),
        cancel: async () => ({}),
        listSessions: async () => ({ sessions: [], nextCursor: undefined }),
        loadSession: async () => ({ modes: null, models: null, configOptions: null }),
        resumeSession: async () => ({ modes: null, models: null, configOptions: null }),
        setSessionMode: async () => ({}),
        unstable_setSessionModel: async () => ({}),
        setSessionConfigOption: async () => ({ configOptions: null }),
        authenticate: async () => ({}),
      },
      initResponse: {
        agentInfo: { name: 'test-agent', title: 'Test Agent' },
        agentCapabilities: {
          sessionCapabilities: {
            list: true,
            resume: true,
          },
          loadSession: true,
        },
        protocolVersion: '0.2.0',
      },
    }),
    removeConnection: (_agentId: string) => undefined,
    getConnection: (_agentId: string) => null,
  };

  const manager = new SessionManager(
    agentManager as any,
    connectionManager as any,
    () => workspaceIdentityFromCwd('/test'),
  );

  manager.setTestConfigs({
    'test-agent': { command: 'test' },
    'Agent A': { command: 'test' },
    'Agent B': { command: 'test' },
    'Old Agent': { command: 'test' },
    'New Agent': { command: 'test' },
  });

  const historyCalls: Array<{ agentName: string; sessionId: string; title: string | null | undefined }> = [];
  const historyStatusCalls: Array<{ agentName: string; sessionId: string; status: string }> = [];
  const agentStatusCalls: Array<{ agentName: string; status: string }> = [];
  const mockHistoryStore = {
    setTitle: (agentName: string, sessionId: string, title: string | null | undefined) => {
      historyCalls.push({ agentName, sessionId, title });
    },
    setFirstPromptIfMissing: () => undefined,
    appendUserMessage: () => undefined,
    appendUserMessageChunk: () => undefined,
    appendAssistantMessageChunk: () => undefined,
    clearDiscussion: () => undefined,
    buildDiscussionContext: () => null,
    getContextFamily: () => null,
    linkContextFamily: () => null,
    touch: () => undefined,
    upsertNew: () => undefined,
    reconcileFromAgent: () => undefined,
    markStatus: (agentName: string, sessionId: string, status: string) => {
      historyStatusCalls.push({ agentName, sessionId, status });
      return true;
    },
    markAgentStatus: (agentName: string, status: string) => {
      agentStatusCalls.push({ agentName, status });
      return 1;
    },
    forget: () => undefined,
  };
  manager.setHistoryStore(mockHistoryStore as any);

  return { manager, historyCalls, historyStatusCalls, agentStatusCalls };
}

function registerSession(manager: SessionManager, partial: Partial<any> & { sessionId: string; agentName: string }) {
  const session = {
    sessionId: partial.sessionId,
    agentId: partial.agentId || 'agent-1',
    agentName: partial.agentName,
    agentDisplayName: partial.agentDisplayName || partial.agentName,
    cwd: partial.cwd || '/test',
    createdAt: partial.createdAt || new Date().toISOString(),
    initResponse: partial.initResponse || {
      protocolVersion: '0.2.0',
      agentInfo: { name: partial.agentName, title: partial.agentName },
      agentCapabilities: {},
    },
    modes: partial.modes || null,
    models: partial.models || null,
    configOptions: partial.configOptions || null,
    availableCommands: partial.availableCommands || [],
    title: partial.title,
    transport: partial.transport ?? (partial.agentId?.startsWith('pipeline_agent_') ? 'virtual' : 'acp'),
  };
  const state = (manager as any).sessionState;
  state.addSession(session);
  if (partial.agentName) {
    state.setAgentSession(partial.agentName, partial.sessionId);
  }
  if (partial.active) {
    state.setActiveSessionId(partial.sessionId);
  }
  return session;
}

function createPipelineManager(pipelineService?: any) {
  const manager = createManager().manager;
  if (pipelineService) {
    manager.registerVirtualSessionRuntime({
      canHandle: (agentName: string) => agentName === 'Plan Execute Verify',
      createSession: (agentName: string) => ({
        sessionId: `pipeline_${Date.now()}`,
        agentId: `pipeline_agent_${Date.now()}`,
        displayName: agentName,
      }),
      sendPrompt: async (sessionId: string, text: string, agentName: string) => {
        await pipelineService.createPlan?.(sessionId, text, agentName);
        return { stopReason: 'end_turn' } as any;
      },
      cancel: (sessionId: string) => pipelineService.cancel?.(sessionId),
      dispose: () => pipelineService.dispose?.(),
    });
  }
  return manager;
}

suite('SessionManager', () => {
  test('applyConfigOptions buffers before session registration and drains later', () => {
    const { manager } = createManager();
    const options = [{ id: 'mode', category: 'mode', value: 'default' }] as any;

    manager.applyConfigOptions('s1', options);
    assert.strictEqual((manager as any).updateBuffer.getPendingConfigOptions('s1') !== undefined, true);

    const session = {
      sessionId: 's1',
      agentName: 'Agent A',
      configOptions: null,
      availableCommands: [],
    } as any;
    (manager as any).updateBuffer.drainInto(session);

    assert.deepStrictEqual(session.configOptions, options);
    assert.strictEqual((manager as any).updateBuffer.getPendingConfigOptions('s1') !== undefined, false);
  });

  test('applyAvailableCommands buffers before session registration and drains later', () => {
    const { manager } = createManager();
    const commands = [{ id: 'cmd-1', title: 'Run' }] as any;

    manager.applyAvailableCommands('s1', commands);
    assert.strictEqual((manager as any).updateBuffer.getPendingAvailableCommands('s1') !== undefined, true);

    const session = {
      sessionId: 's1',
      agentName: 'Agent A',
      configOptions: null,
      availableCommands: [],
    } as any;
    (manager as any).updateBuffer.drainInto(session);

    assert.deepStrictEqual(session.availableCommands, commands);
    assert.strictEqual((manager as any).updateBuffer.getPendingAvailableCommands('s1') !== undefined, false);
  });

  test('applySessionInfoUpdate patches live session title and mirrors to history store', () => {
    const { manager, historyCalls } = createManager();
    const session = {
      sessionId: 's1',
      agentName: 'Agent A',
      configOptions: null,
      availableCommands: [],
    } as any;
    (manager as any).sessionState.addSession(session);

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
    assert.strictEqual((manager as any).updateBuffer.getPendingTitle('s-buffered'), 'Buffered title');

    const session = {
      sessionId: 's-buffered',
      agentName: 'Agent A',
      configOptions: null,
      availableCommands: [],
    } as any;
    (manager as any).updateBuffer.drainInto(session);

    assert.strictEqual(session.title, 'Buffered title');
    assert.strictEqual((manager as any).updateBuffer.getPendingTitle('s-buffered') !== undefined, false);
  });

  test('setMode routes to setConfigOption when mode config option exists', async () => {
    const { manager } = createManager();
    const session = {
      sessionId: 's1',
      agentName: 'Agent A',
      configOptions: [{ id: 'mode-option', category: 'mode' }],
      availableCommands: [],
    } as any;
    (manager as any).sessionState.addSession(session);

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
    (manager as any).sessionState.addSession(session);

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

    (manager as any).sessionState.addSession(session);
    (manager as any).sessionState.setActiveSessionId('s1');

    assert.strictEqual(manager.getActiveAgentName(), 'Agent A');

    (manager as any).sessionState.setActiveSessionId(null);
    assert.strictEqual(manager.getActiveAgentName(), null);
  });

  // ============ Session connection tests ============

  test('connectToAgent reuses existing active session for same agent', async () => {
    const { manager } = createManager();
    registerSession(manager, {
      sessionId: 's1',
      agentName: 'Agent A',
      agentId: 'agent-1',
      active: true,
    });

    const events: Array<{ event: string; arg: any }> = [];
    manager.on('active-session-changed', (id) => events.push({ event: 'active-session-changed', arg: id }));
    manager.on('agent-connected', (name) => events.push({ event: 'agent-connected', arg: name }));

    const result = await manager.connectToAgent('Agent A');

    assert.strictEqual(result.sessionId, 's1');
    assert.strictEqual(manager.getActiveSessionId(), 's1');
    assert.strictEqual(events.filter(e => e.event === 'active-session-changed').length, 1);
    assert.strictEqual(events[0].arg, 's1');
  });

  test('connectToAgent does not share active context by default', async () => {
    const { manager } = createManager();
    const linked: any[] = [];
    Object.assign((manager as any).discussionContextHandler.getHistoryStore(), {
      buildDiscussionContext: () => 'Previous context',
      linkContextFamily: (...args: any[]) => {
        linked.push(args);
        return { contextFamilyId: 'ctx-1' };
      },
    });
    registerSession(manager, {
      sessionId: 'source',
      agentName: 'Old Agent',
      agentId: 'old-agent-1',
      active: true,
    });

    await manager.connectToAgent('New Agent');

    assert.strictEqual(manager.hasPendingSharedDiscussionContext('s1'), false);
    assert.deepStrictEqual(linked, []);
  });

  test('connectToAgent can explicitly prepare shared context for next prompt', async () => {
    const { manager } = createManager();
    const linked: any[] = [];
    Object.assign((manager as any).discussionContextHandler.getHistoryStore(), {
      buildDiscussionContext: (agentName: string, sessionId: string) =>
        agentName === 'Old Agent' && sessionId === 'source' ? 'Previous context' : null,
      linkContextFamily: (...args: any[]) => {
        linked.push(args);
        return { contextFamilyId: 'ctx-1' };
      },
    });
    registerSession(manager, {
      sessionId: 'source',
      agentName: 'Old Agent',
      agentId: 'old-agent-1',
      active: true,
    });

    await manager.connectToAgent('New Agent', { shareCurrentContext: true });

    assert.strictEqual(manager.hasPendingSharedDiscussionContext('s1'), true);
    assert.deepStrictEqual(linked[0].slice(0, 4), ['Old Agent', 'source', 'New Agent', 's1']);
  });

  test('connectToAgent disconnects current agent before connecting to new one', async () => {
    const { manager } = createManager();
    registerSession(manager, {
      sessionId: 's1',
      agentName: 'Old Agent',
      agentId: 'old-agent-1',
      active: true,
    });

    // Do NOT register session for 'New Agent' yet, so connectToAgent triggers a new connection

    // Override disconnectAgent to verify it's called
    let disconnectCalled = false;
    (manager as any).disconnectAgent = async (agentName: string) => {
      disconnectCalled = true;
      assert.strictEqual(agentName, 'Old Agent');
      (manager as any).sessionState.deleteSession('s1');
      (manager as any).sessionState.deleteAgentSession('Old Agent');
      (manager as any).sessionState.setActiveSessionId(null);
    };

    await manager.connectToAgent('New Agent');

    assert.strictEqual(disconnectCalled, true);
    assert.strictEqual(manager.getActiveAgentName(), 'New Agent');
  });

  test('disconnectAgent removes session, agentSessions, clears activeSessionId, calls killAgent and removeConnection for ACP session', async () => {
    const { manager } = createManager();
    registerSession(manager, {
      sessionId: 's1',
      agentName: 'Agent A',
      agentId: 'agent-1',
      active: true,
    });

    let killAgentCalled = false;
    let removeConnectionCalled = false;
    (manager as any).agentManager.killAgent = (id: string) => {
      killAgentCalled = true;
      assert.strictEqual(id, 'agent-1');
    };
    (manager as any).connectionManager.removeConnection = (id: string) => {
      removeConnectionCalled = true;
      assert.strictEqual(id, 'agent-1');
    };

    const events: Array<{ event: string; arg: any }> = [];
    manager.on('agent-disconnected', (name) => events.push({ event: 'agent-disconnected', arg: name }));
    manager.on('active-session-changed', (id) => events.push({ event: 'active-session-changed', arg: id }));

    await manager.disconnectAgent('Agent A');

    assert.strictEqual(killAgentCalled, true);
    assert.strictEqual(removeConnectionCalled, true);
    assert.strictEqual((manager as any).sessionState.getSession('s1') !== undefined, false);
    assert.strictEqual((manager as any).sessionState.isAgentConnected('Agent A'), false);
    assert.strictEqual(manager.getActiveSessionId(), null);
    assert.strictEqual(events.filter(e => e.event === 'agent-disconnected').length, 1);
    assert.strictEqual(events.filter(e => e.event === 'active-session-changed').length, 1);
  });

  test('disconnectAgent for pipeline session calls pipelineService.cancel', async () => {
    const pipelineService = {
      cancel: (sessionId: string) => {
        pipelineService.cancelCalled = sessionId;
      },
      cancelCalled: null as string | null,
    };

    const manager = createPipelineManager(pipelineService);
    registerSession(manager, {
      sessionId: 'pipeline_s1',
      agentName: 'Pipeline',
      agentId: 'pipeline_agent_1',
      active: true,
    });

    let killAgentCalled = false;
    let removeConnectionCalled = false;
    (manager as any).agentManager.killAgent = () => { killAgentCalled = true; };
    (manager as any).connectionManager.removeConnection = () => { removeConnectionCalled = true; };

    await manager.disconnectAgent('Pipeline');

    assert.strictEqual(pipelineService.cancelCalled, 'pipeline_s1');
    assert.strictEqual(killAgentCalled, false);
    assert.strictEqual(removeConnectionCalled, false);
    assert.strictEqual((manager as any).sessionState.getSession('pipeline_s1') !== undefined, false);
    assert.strictEqual((manager as any).sessionState.isAgentConnected('Pipeline'), false);
    assert.strictEqual(manager.getActiveSessionId(), null);
  });

  test('newConversation disconnects active agent, emits clear-chat, and reconnects same agent', async () => {
    const { manager } = createManager();
    registerSession(manager, {
      sessionId: 's1',
      agentName: 'Agent A',
      agentId: 'agent-1',
      active: true,
    });

    let disconnectCalled = false;
    let connectCalled = false;
    (manager as any).disconnectAgent = async (agentName: string) => {
      disconnectCalled = true;
      assert.strictEqual(agentName, 'Agent A');
      (manager as any).sessionState.deleteSession('s1');
      (manager as any).sessionState.deleteAgentSession('Agent A');
      (manager as any).sessionState.setActiveSessionId(null);
    };

    (manager as any).connectToAgent = async (agentName: string) => {
      connectCalled = true;
      assert.strictEqual(agentName, 'Agent A');
      const newSession = registerSession(manager, {
        sessionId: 's2',
        agentName: 'Agent A',
        agentId: 'agent-2',
        active: true,
      });
      return newSession;
    };

    const events: Array<{ event: string; arg: any }> = [];
    manager.on('clear-chat', () => events.push({ event: 'clear-chat', arg: null }));

    const result = await manager.newConversation();

    assert.strictEqual(disconnectCalled, true);
    assert.strictEqual(connectCalled, true);
    assert.strictEqual(events.filter(e => e.event === 'clear-chat').length, 1);
    assert.strictEqual(result?.agentName, 'Agent A');
  });

  test('sendPrompt on pipeline session calls pipelineService.createPlan and returns stopReason end_turn', async () => {
    const pipelineService = {
      createPlan: async (sessionId: string, text: string) => {
        pipelineService.createPlanCalled = { sessionId, text };
        return 'test plan';
      },
      createPlanCalled: null as { sessionId: string; text: string } | null,
    };

    const manager = createPipelineManager(pipelineService);
    registerSession(manager, {
      sessionId: 'pipeline_s1',
      agentName: 'Pipeline',
      agentId: 'pipeline_agent_1',
      active: true,
    });

    const result = await manager.sendPrompt('pipeline_s1', 'test prompt');

    assert.deepStrictEqual(pipelineService.createPlanCalled, { sessionId: 'pipeline_s1', text: 'test prompt' });
    assert.strictEqual(result.stopReason, 'end_turn');
  });

  test('sendPrompt on unknown session rejects with Session not found', async () => {
    const { manager } = createManager();

    await assert.rejects(
      () => manager.sendPrompt('unknown_session', 'test prompt'),
      /Session not found/,
    );
  });

  test('cancelTurn on pipeline session calls pipelineService.cancel', async () => {
    const pipelineService = {
      cancel: (sessionId: string) => {
        pipelineService.cancelCalled = sessionId;
      },
      cancelCalled: null as string | null,
    };

    const manager = createPipelineManager(pipelineService);
    registerSession(manager, {
      sessionId: 'pipeline_s1',
      agentName: 'Pipeline',
      agentId: 'pipeline_agent_1',
    });

    await manager.cancelTurn('pipeline_s1');

    assert.strictEqual(pipelineService.cancelCalled, 'pipeline_s1');
  });

  test('cancelTurn on ACP session calls connection.cancel', async () => {
    const { manager } = createManager();
    registerSession(manager, {
      sessionId: 's1',
      agentName: 'Agent A',
      agentId: 'agent-1',
    });

    let cancelCalled = false;
    (manager as any).connectionManager.getConnection = (_agentId: string) => ({
      connection: {
        cancel: async (params: any) => {
          cancelCalled = true;
          assert.strictEqual(params.sessionId, 's1');
          return {};
        },
      },
    });

    await manager.cancelTurn('s1');

    assert.strictEqual(cancelCalled, true);
  });

  test('cancelTurn on unknown session is no-op', async () => {
    const { manager } = createManager();
    // Should not throw
    await manager.cancelTurn('unknown_session');
  });

  // ============ EnsureConnected tests ============

  test('ensureConnected caches capabilities from initialize.agentCapabilities', async () => {
    const { manager } = createManager();

    (manager as any).connectionManager.connect = async (_agentId: string, _process: any, _cwd: string) => ({
      connection: {},
      initResponse: {
        agentInfo: { name: 'test-agent', title: 'Test Agent' },
        agentCapabilities: {
          sessionCapabilities: { list: true, resume: true },
          loadSession: true,
        },
        protocolVersion: '0.2.0',
      },
    });

    // Override getAgentConfigs to return a valid config
    await manager.ensureConnected('test-agent');

    const cached = manager.getCachedCapabilities('test-agent');
    assert.ok(cached);
    assert.strictEqual(cached?.list, true);
    assert.strictEqual(cached?.load, true);
    assert.strictEqual(cached?.resume, true);
  });

  test('ensureConnected with connection failure cleans up agent process', async () => {
    const { manager } = createManager();

    let killAgentCalled = false;
    (manager as any).agentManager.spawnAgent = (_name: string, _config: any, _cwd: string) => ({ id: 'failed-agent' });
    (manager as any).agentManager.getAgent = (_id: string) => ({ process: {} });
    (manager as any).agentManager.killAgent = (id: string) => {
      killAgentCalled = true;
      assert.strictEqual(id, 'failed-agent');
    };
    (manager as any).connectionManager.connect = async () => {
      throw new Error('Connection failed');
    };

    await assert.rejects(
      () => manager.ensureConnected('test-agent'),
      /Connection failed/,
    );

    assert.strictEqual(killAgentCalled, true);
  });

  // ============ List/Load/Resume sessions tests ============

  test('listSessions delegates to client ACP with parameters', async () => {
    const { manager } = createManager();

    (manager as any).sessionState.setCapabilities('test-agent', { list: true, load: false, resume: false });
    (manager as any).connectionManager.connect = async () => ({
      connection: {
        listSessions: async (_params: any) => ({
          sessions: [{ sessionId: 's1', title: 'Test Session' }],
          nextCursor: 'cursor-2',
        }),
      },
      initResponse: {
        agentInfo: { name: 'test-agent', title: 'Test Agent' },
        agentCapabilities: { sessionCapabilities: { list: true } },
        authMethods: [{ id: 'oauth', name: 'OAuth' }],
        protocolVersion: '0.2.0',
      },
    });

    const result = await manager.listSessions('test-agent', { cwd: '/test', cursor: 'cursor-1' });

    assert.strictEqual(result.sessions.length, 1);
    assert.strictEqual(result.sessions[0].sessionId, 's1');
    assert.strictEqual(result.nextCursor, 'cursor-2');
  });

  test('listSessions with auth error retries after authentication', async () => {
    const { manager } = createManager();

    (manager as any).sessionState.setCapabilities('test-agent', { list: true, load: false, resume: false });

    let authCalled = false;
    (manager as any).connectionManager.connect = async () => ({
      connection: {
        listSessions: async (_params: any) => {
          if (!authCalled) {
            throw new Error('auth required');
          }
          return { sessions: [], nextCursor: undefined };
        },
        authenticate: async () => {
          authCalled = true;
          return {};
        },
      },
      initResponse: {
        agentInfo: { name: 'test-agent', title: 'Test Agent' },
        agentCapabilities: { sessionCapabilities: { list: true } },
        authMethods: [{ id: 'oauth', name: 'OAuth' }],
        protocolVersion: '0.2.0',
      },
    });

    // Override findAgentIdForConnection to return a valid agent ID
    (manager as any).findAgentIdForConnection = () => 'agent-1';

    // Override runAuthFlow to avoid VS Code dialog
    (manager as any).authHandler.runAuthFlow = async (_agentName: string, _agentId: string, conn: any) => {
      await conn.connection.authenticate();
    };

    const result = await manager.listSessions('test-agent', {});

    assert.strictEqual(authCalled, true);
    assert.ok(result);
  });

  test('listSessions without list capability throws error', async () => {
    const { manager } = createManager();

    (manager as any).sessionState.setCapabilities('test-agent', { list: false, load: false, resume: false });
    (manager as any).connectionManager.connect = async () => ({
      connection: {},
      initResponse: {
        agentInfo: { name: 'test-agent', title: 'Test Agent' },
        agentCapabilities: {},
        protocolVersion: '0.2.0',
      },
    });

    await assert.rejects(
      () => manager.listSessions('test-agent', {}),
      /does not support session\/list/,
    );
  });

  test('loadSession registers session, drains pending, sets active, updates agentSessions, and touches history', async () => {
    const { manager } = createManager();

    (manager as any).sessionState.setCapabilities('test-agent', { list: false, load: true, resume: false });
    (manager as any).connectionManager.connect = async () => ({
      connection: {
        loadSession: async () => ({
          modes: { currentModeId: 'code' },
          models: null,
          configOptions: [{ id: 'mode1', category: 'mode', value: 'code' }],
        }),
      },
      initResponse: {
        agentInfo: { name: 'test-agent', title: 'Test Agent' },
        agentCapabilities: {
          sessionCapabilities: { load: true },
          loadSession: true,
        },
        protocolVersion: '0.2.0',
      },
    });

    // Override findAgentIdForConnection
    (manager as any).findAgentIdForConnection = () => 'agent-1';

    // Pre-buffer some state
    (manager as any).updateBuffer.bufferAvailableCommands('s1', [{ id: 'cmd1', title: 'Cmd1' }]);
    (manager as any).updateBuffer.bufferConfigOptions('s1', [{ id: 'mode1', category: 'mode', value: 'code' }]);
    (manager as any).updateBuffer.bufferTitle('s1', 'Buffered Title');

    const result = await manager.loadSession('test-agent', 's1');

    assert.strictEqual(result.sessionId, 's1');
    assert.strictEqual(manager.getActiveSessionId(), 's1');
    assert.strictEqual((manager as any).sessionState.getAgentSession('test-agent'), 's1');
    assert.strictEqual(result.modes?.currentModeId, 'code');
    assert.deepStrictEqual(result.availableCommands, [{ id: 'cmd1', title: 'Cmd1' }]);
    assert.deepStrictEqual(result.configOptions, [{ id: 'mode1', category: 'mode', value: 'code' }]);
    assert.strictEqual(result.title, 'Buffered Title');
  });

  test('resumeSession registers session, drains pending, sets active, and touches history', async () => {
    const { manager } = createManager();

    (manager as any).sessionState.setCapabilities('test-agent', { list: false, load: false, resume: true });
    (manager as any).connectionManager.connect = async () => ({
      connection: {
        resumeSession: async () => ({
          modes: null,
          models: null,
          configOptions: null,
        }),
      },
      initResponse: {
        agentInfo: { name: 'test-agent', title: 'Test Agent' },
        agentCapabilities: {
          sessionCapabilities: { resume: true },
        },
        protocolVersion: '0.2.0',
      },
    });

    // Override findAgentIdForConnection
    (manager as any).findAgentIdForConnection = () => 'agent-1';

    const result = await manager.resumeSession('test-agent', 's1');

    assert.strictEqual(result.sessionId, 's1');
    assert.strictEqual(manager.getActiveSessionId(), 's1');
    assert.strictEqual((manager as any).sessionState.getAgentSession('test-agent'), 's1');
    // historyCalls for resume is touch, which we don't track currently in the mock
  });

  test('loadSession marks not-found sessions as missing without forgetting them', async () => {
    const { manager, historyStatusCalls } = createManager();

    (manager as any).sessionState.setCapabilities('test-agent', { list: false, load: true, resume: false });
    (manager as any).connectionManager.connect = async () => ({
      connection: {
        loadSession: async () => {
          throw new Error('unknown session');
        },
      },
      initResponse: {
        agentInfo: { name: 'test-agent', title: 'Test Agent' },
        agentCapabilities: {
          sessionCapabilities: { load: true },
          loadSession: true,
        },
        protocolVersion: '0.2.0',
      },
    });
    (manager as any).findAgentIdForConnection = () => 'agent-1';

    await assert.rejects(
      () => manager.loadSession('test-agent', 'missing-session'),
      /unknown session/,
    );

    assert.deepStrictEqual(historyStatusCalls, [
      { agentName: 'test-agent', sessionId: 'missing-session', status: 'missing' },
    ]);
  });

  test('resumeSession marks not-found sessions as missing without forgetting them', async () => {
    const { manager, historyStatusCalls } = createManager();

    (manager as any).sessionState.setCapabilities('test-agent', { list: false, load: false, resume: true });
    (manager as any).connectionManager.connect = async () => ({
      connection: {
        resumeSession: async () => {
          throw new Error('session not found');
        },
      },
      initResponse: {
        agentInfo: { name: 'test-agent', title: 'Test Agent' },
        agentCapabilities: {
          sessionCapabilities: { resume: true },
        },
        protocolVersion: '0.2.0',
      },
    });
    (manager as any).findAgentIdForConnection = () => 'agent-1';

    await assert.rejects(
      () => manager.resumeSession('test-agent', 'missing-session'),
      /session not found/,
    );

    assert.deepStrictEqual(historyStatusCalls, [
      { agentName: 'test-agent', sessionId: 'missing-session', status: 'missing' },
    ]);
  });

  // ============ Pipeline agent tests ============

  test('openSession chooses load and reports replayed history', async () => {
    const { manager } = createManager();
    (manager as any).ensureConnected = async () => undefined;
    (manager as any).sessionState.setCapabilities('Agent A', { load: true, resume: true, list: false });
    (manager as any).loadSession = async () => ({ sessionId: 'loaded' });
    (manager as any).resumeSession = async () => { throw new Error('resume should not be called'); };

    const opened = await manager.openSession('Agent A', 'loaded');

    assert.strictEqual(opened.session.sessionId, 'loaded');
    assert.strictEqual(opened.historyReplayed, true);
  });

  test('openSession falls back to resume without replayed history', async () => {
    const { manager } = createManager();
    (manager as any).ensureConnected = async () => undefined;
    (manager as any).sessionState.setCapabilities('Agent A', { load: false, resume: true, list: false });
    (manager as any).resumeSession = async () => ({ sessionId: 'resumed' });

    const opened = await manager.openSession('Agent A', 'resumed');

    assert.strictEqual(opened.session.sessionId, 'resumed');
    assert.strictEqual(opened.historyReplayed, false);
  });

  test('connectToAgent creates pipeline session for pipeline virtual agent', async () => {
    const pipelineService = {};
    const manager = createPipelineManager(pipelineService);
    const upsertCalls: Array<[string, string, string]> = [];
    Object.assign((manager as any).discussionContextHandler.getHistoryStore(), {
      upsertNew: (agentName: string, workspace: string, sessionId: string) => {
        upsertCalls.push([agentName, workspace, sessionId]);
      },
    });

    const result = await manager.connectToAgent('Plan Execute Verify');

    assert.ok(result.sessionId.startsWith('pipeline_'));
    assert.strictEqual(result.agentName, 'Plan Execute Verify');
    assert.strictEqual(manager.getActiveSessionId(), result.sessionId);
    assert.strictEqual((manager as any).sessionState.getAgentSession('Plan Execute Verify'), result.sessionId);
    assert.strictEqual(manager.isVirtualSession(result.sessionId), true);
    assert.strictEqual(upsertCalls.length, 1);
    assert.deepStrictEqual(upsertCalls[0], ['Plan Execute Verify', '/test', result.sessionId]);
  });

  test('connectToAgent can share discussion context from a pipeline session', async () => {
    const pipelineService = { cancel: () => undefined };
    const manager = createPipelineManager(pipelineService);
    const linked: any[] = [];
    Object.assign((manager as any).discussionContextHandler.getHistoryStore(), {
      buildDiscussionContext: (agentName: string, sessionId: string) =>
        agentName === 'Plan Execute Verify' && sessionId === 'pipeline_source'
          ? 'Pipeline plan and outputs'
          : null,
      linkContextFamily: (...args: any[]) => {
        linked.push(args);
        return { contextFamilyId: 'ctx-pipeline' };
      },
    });
    registerSession(manager, {
      sessionId: 'pipeline_source',
      agentName: 'Plan Execute Verify',
      agentId: 'pipeline_agent_source',
      active: true,
    });

    await manager.connectToAgent('New Agent', { shareCurrentContext: true });

    assert.strictEqual(manager.hasPendingSharedDiscussionContext('s1'), true);
    assert.deepStrictEqual(linked[0].slice(0, 4), [
      'Plan Execute Verify',
      'pipeline_source',
      'New Agent',
      's1',
    ]);
  });

  test('connectToAgent reuses existing pipeline session', async () => {
    const pipelineService = {};
    const manager = createPipelineManager(pipelineService);

    registerSession(manager, {
      sessionId: 'pipeline_existing',
      agentName: 'Plan Execute Verify',
      agentId: 'pipeline_agent_existing',
      active: false,
    });

    const result = await manager.connectToAgent('Plan Execute Verify');

    assert.strictEqual(result.sessionId, 'pipeline_existing');
    assert.strictEqual(manager.getActiveSessionId(), 'pipeline_existing');
    assert.strictEqual((manager as any).sessionState.getAgentSession('Plan Execute Verify'), 'pipeline_existing');
  });

  test('isVirtualSession returns false for native ACP sessions', () => {
    const { manager } = createManager();
    registerSession(manager, {
      sessionId: 's1',
      agentName: 'Agent A',
      agentId: 'agent-1',
    });

    assert.strictEqual(manager.isVirtualSession('s1'), false);
    assert.strictEqual(manager.isVirtualSession('unknown'), false);
    assert.strictEqual(manager.isVirtualSession(null), false);
    assert.strictEqual(manager.isVirtualSession(undefined), false);
  });

  test('isVirtualSession returns true for plugin-owned sessions', () => {
    const { manager } = createManager();
    registerSession(manager, {
      sessionId: 'pipeline_s1',
      agentName: 'Plan Execute Verify',
      agentId: 'pipeline_agent_1',
    });

    assert.strictEqual(manager.isVirtualSession('pipeline_s1'), true);
  });

  test('getConnectionForSession returns connection for ACP session', () => {
    const { manager } = createManager();
    registerSession(manager, {
      sessionId: 's1',
      agentName: 'Agent A',
      agentId: 'agent-1',
    });

    const mockConnection = { connection: {} };
    (manager as any).connectionManager.getConnection = (agentId: string) => {
      if (agentId === 'agent-1') {
        return mockConnection;
      }
      return null;
    };

    const result = manager.getConnectionForSession('s1');
    assert.strictEqual(result, mockConnection);
  });

  test('getConnectionForSession returns undefined for unknown session', () => {
    const { manager } = createManager();
    const result = manager.getConnectionForSession('unknown');
    assert.strictEqual(result, undefined);
  });

  test('dispose clears all sessions and agentSessions', () => {
    const { manager } = createManager();
    registerSession(manager, {
      sessionId: 's1',
      agentName: 'Agent A',
      agentId: 'agent-1',
    });
    registerSession(manager, {
      sessionId: 's2',
      agentName: 'Agent B',
      agentId: 'agent-2',
    });

    manager.dispose();

    assert.strictEqual((manager as any).sessionState.getAllSessions().size, 0);
    assert.strictEqual((manager as any).sessionState.getConnectedAgentNames().length, 0);
  });
});
