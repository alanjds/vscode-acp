import * as assert from 'assert';

import { SessionManager } from '../core/SessionManager';
import { workspaceIdentityFromCwd } from '../core/WorkspaceIdentity';

suite('SessionManager.ingestSessionUpdate', () => {
  test('persists assistant chunks from agent_message_chunk updates', () => {
    const assistantChunks: string[] = [];
    const manager = createManager({ assistantChunks });

    manager.ingestSessionUpdate('session-1', {
      sessionId: 'session-1',
      update: {
        sessionUpdate: 'agent_message_chunk',
        content: { type: 'text', text: 'hello' },
      },
    } as any);

    assert.deepStrictEqual(assistantChunks, ['hello']);
  });

  test('persists user chunks only while session is loading', () => {
    const userChunks: string[] = [];
    const manager = createManager({ userChunks });
    (manager as any).sessionState.markLoading('session-1');

    manager.ingestSessionUpdate('session-1', {
      sessionId: 'session-1',
      update: {
        sessionUpdate: 'user_message_chunk',
        content: { type: 'text', text: 'replay' },
      },
    } as any);
    assert.deepStrictEqual(userChunks, ['replay']);

    (manager as any).sessionState.unmarkLoading('session-1');
    manager.ingestSessionUpdate('session-1', {
      sessionId: 'session-1',
      update: {
        sessionUpdate: 'user_message_chunk',
        content: { type: 'text', text: 'ignored' },
      },
    } as any);
    assert.deepStrictEqual(userChunks, ['replay']);
  });
});

function createManager(trackers: {
  assistantChunks?: string[];
  userChunks?: string[];
} = {}) {
  const assistantChunks = trackers.assistantChunks ?? [];
  const userChunks = trackers.userChunks ?? [];

  const agentManager = {
    killAll: () => undefined,
    spawnAgent: () => ({ id: 'agent-1' }),
    getAgent: () => ({ process: {} }),
    getRunningAgents: () => [],
    on: () => undefined,
    killAgent: () => undefined,
  };

  const connectionManager = {
    dispose: () => undefined,
    connect: async () => ({
      connection: {
        newSession: async () => ({ sessionId: 'session-1' }),
      },
      initResponse: { agentCapabilities: {}, protocolVersion: '0.2.0' },
    }),
    removeConnection: () => undefined,
    getConnection: () => null,
  };

  const manager = new SessionManager(
    agentManager as any,
    connectionManager as any,
    () => workspaceIdentityFromCwd('/test'),
  );

  manager.setTestConfigs({ 'test-agent': { command: 'test' } });
  manager.setHistoryStore({
    appendAssistantMessageChunk: (_agentName: string, _sessionId: string, text: string) => {
      assistantChunks.push(text);
    },
    appendUserMessageChunk: (_agentName: string, _sessionId: string, text: string) => {
      userChunks.push(text);
    },
    setTitle: () => undefined,
    setFirstPromptIfMissing: () => undefined,
    appendUserMessage: () => undefined,
    clearDiscussion: () => undefined,
    buildDiscussionContext: () => null,
    getContextFamily: () => null,
    linkContextFamily: () => undefined,
    touch: () => undefined,
    upsertNew: () => undefined,
    reconcileFromAgent: () => undefined,
    markStatus: () => true,
    markAgentStatus: () => 1,
    forget: () => undefined,
  } as any);

  (manager as any).sessionState.addSession({
    sessionId: 'session-1',
    agentId: 'agent-1',
    agentName: 'test-agent',
    agentDisplayName: 'Test Agent',
    cwd: '/test',
    transport: 'nativeAcp',
    createdAt: new Date().toISOString(),
    initResponse: {
      protocolVersion: '0.2.0',
      agentInfo: { name: 'test-agent', title: 'Test Agent' },
      agentCapabilities: {},
    },
    modes: null,
    models: null,
    configOptions: null,
    availableCommands: [],
  });

  return manager;
}
