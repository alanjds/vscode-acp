import * as assert from 'assert';

import {
  collectConversationUpdateEffects,
  projectConversationUpdate,
} from '../core/ConversationUpdateIngestor';
import { SessionManager } from '../core/SessionManager';
import { workspaceIdentityFromCwd } from '../core/WorkspaceIdentity';

suite('ConversationUpdateIngestor', () => {
  test('collects session metadata and transcript effects from ACP updates', () => {
    assert.deepStrictEqual(
      collectConversationUpdateEffects({
        sessionId: 'session-1',
        update: {
          sessionUpdate: 'available_commands_update',
          availableCommands: [{ name: 'review', description: 'Review code' }],
        },
      } as any, { isLoading: false }),
      {
        sessionId: 'session-1',
        availableCommands: [{ name: 'review', description: 'Review code' }],
      },
    );

    assert.deepStrictEqual(
      collectConversationUpdateEffects({
        sessionId: 'session-1',
        update: {
          sessionUpdate: 'session_info_update',
          title: 'A better title',
          updatedAt: '2026-06-23T08:00:00.000Z',
        },
      } as any, { isLoading: false }),
      {
        sessionId: 'session-1',
        sessionInfo: {
          title: 'A better title',
          updatedAt: '2026-06-23T08:00:00.000Z',
        },
      },
    );

    assert.deepStrictEqual(
      collectConversationUpdateEffects({
        sessionId: 'session-1',
        update: {
          sessionUpdate: 'user_message_chunk',
          content: { type: 'text', text: 'replayed prompt' },
        },
      } as any, { isLoading: true }),
      {
        sessionId: 'session-1',
        replayedUserMessageChunk: 'replayed prompt',
      },
    );
  });

  test('projects forwarding only for the active conversation', () => {
    const notification = {
      sessionId: 'session-1',
      update: {
        sessionUpdate: 'agent_message_chunk',
        content: { type: 'text', text: 'hello' },
      },
    } as any;

    assert.strictEqual(
      projectConversationUpdate(notification, 'session-1').shouldForwardToActiveConversation,
      true,
    );
    assert.strictEqual(
      projectConversationUpdate(notification, 'session-2').shouldForwardToActiveConversation,
      false,
    );
  });
});

suite('SessionManager.projectAndApply', () => {
  test('persists assistant chunks from agent_message_chunk updates', () => {
    const assistantChunks: string[] = [];
    const manager = createManager({ assistantChunks });

    manager.projectAndApply(
      {
        kind: 'acp-session-update',
        notification: {
          sessionId: 'session-1',
          update: {
            sessionUpdate: 'agent_message_chunk',
            content: { type: 'text', text: 'hello' },
          },
        } as any,
      },
      {
        activeSessionId: 'session-1',
        isLoading: () => false,
      },
    );

    assert.deepStrictEqual(assistantChunks, ['hello']);
  });

  test('persists user chunks only while session is loading', () => {
    const userChunks: string[] = [];
    const manager = createManager({ userChunks });
    (manager as any).sessionState.markLoading('session-1');

    manager.projectAndApply(
      {
        kind: 'acp-session-update',
        notification: {
          sessionId: 'session-1',
          update: {
            sessionUpdate: 'user_message_chunk',
            content: { type: 'text', text: 'replay' },
          },
        } as any,
      },
      {
        activeSessionId: 'session-1',
        isLoading: (sessionId) => manager.isLoading(sessionId),
      },
    );
    assert.deepStrictEqual(userChunks, ['replay']);

    (manager as any).sessionState.unmarkLoading('session-1');
    manager.projectAndApply(
      {
        kind: 'acp-session-update',
        notification: {
          sessionId: 'session-1',
          update: {
            sessionUpdate: 'user_message_chunk',
            content: { type: 'text', text: 'ignored' },
          },
        } as any,
      },
      {
        activeSessionId: 'session-1',
        isLoading: (sessionId) => manager.isLoading(sessionId),
      },
    );
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
