import * as assert from 'assert';
import * as path from 'path';
import * as vscode from 'vscode';

import { ChatWebviewController } from '../ui/ChatWebviewController';
import { ChatWebviewStateStore } from '../ui/ChatWebviewStateStore';
import { OrchestrationWebviewStateStore } from '../ui/OrchestrationWebviewStateStore';
import { emptySharedState } from '../ui/ChatWebviewSharedState';
import { emptyOrchestrationState } from '../ui/OrchestrationState';
import type { EditorContext } from '../ui/EditorContext';

suite('ChatWebviewController', () => {
  const workspaceRoot = path.join(path.parse(process.cwd()).root, 'workspace');
  const examplePath = path.join(workspaceRoot, 'src', 'example.ts');

  async function createController(editorContext: EditorContext | null = null) {
    const sentPrompts: string[] = [];
    const recordedPrompts: string[] = [];
    const messagesByEndpoint = new Map<string, any[]>();
    const sessions = new Map<string, any>([
      ['session-1', {
        sessionId: 'session-1',
        agentDisplayName: 'agent-1',
        title: undefined,
        cwd: workspaceRoot,
        modes: null,
        models: null,
        configOptions: null,
        availableCommands: [],
      }],
    ]);

    const sessionManager = {
      sessions,
      getActiveSessionId: () => 'session-1',
      getActiveAgentName: () => 'agent-1',
      getSession: (sessionId: string) => sessions.get(sessionId),
      getSessionContextFamily: () => null,
      hasPendingSharedDiscussionContext: () => false,
      recordUserMessage: (_sessionId: string, prompt: string) => {
        recordedPrompts.push(prompt);
      },
      projectAndApply: (input: any) => {
        const update = input.notification;
        return {
          sessionId: update.sessionId,
          sessionEffects: { sessionId: update.sessionId },
          webviewMessages: update.sessionId === 'session-1'
            ? [{
                type: 'sessionUpdate',
                update: update.update,
                sessionId: update.sessionId,
              }]
            : [],
          shouldForwardToActiveConversation: update.sessionId === 'session-1',
        };
      },
      sendPrompt: async (_sessionId: string, prompt: string) => {
        sentPrompts.push(prompt);
        return { stopReason: 'end_turn' };
      },
      touchHistory: () => undefined,
      applyAvailableCommands: () => undefined,
      applyConfigOptions: () => undefined,
      applySessionInfoUpdate: () => undefined,
      isPipelineSession: () => false,
      isLoading: () => false,
      getConnectedAgentNames: () => ['agent-1'],
    };
    const sessionUpdateHandler = {
      addListener: () => undefined,
      removeListener: () => undefined,
    };

    const memento = {
      get: () => undefined,
      update: async () => undefined,
      keys: () => [],
    } as unknown as vscode.Memento;
    const stateStore = new ChatWebviewStateStore(memento);
    const orchestrationStateStore = new OrchestrationWebviewStateStore(memento);

    const controller = new ChatWebviewController(
      vscode.Uri.file(workspaceRoot),
      sessionManager as any,
      sessionUpdateHandler as any,
      stateStore,
      orchestrationStateStore,
      () => editorContext,
    );

    function attachEndpoint(id: string) {
      const messages: any[] = [];
      messagesByEndpoint.set(id, messages);
      let messageHandler: (m: any) => Promise<void> = async () => {};

      const webview = {
        postMessage: (message: any) => {
          messages.push(message);
          return Promise.resolve(true);
        },
        onDidReceiveMessage: (handler: any) => {
          messageHandler = handler;
          return { dispose: () => {} };
        },
      };

      controller.attachWebview({
        id,
        kind: id.startsWith('editor') ? 'editorPanel' : 'view',
        webview: webview as any,
      });

      return {
        messages,
        triggerMessage: (m: any) => messageHandler(m),
        markReady: async () => messageHandler({ type: 'ready' }),
      };
    }

    const view = attachEndpoint('view-1');
    await view.markReady();

    return {
      controller,
      stateStore,
      orchestrationStateStore,
      sentPrompts,
      recordedPrompts,
      messages: view.messages,
      triggerMessage: view.triggerMessage,
      attachEndpoint,
      sessionManager,
    };
  }

  const editorContext: EditorContext = {
    filePath: examplePath,
    cursorLine: 7,
    cursorCharacter: 3,
    language: 'ts',
    selection: {
      startLine: 7,
      startCharacter: 1,
      endLine: 7,
      endCharacter: 10,
      text: 'const x = 1;',
    },
    currentLine: null,
    openEditors: [],
  };

  test('broadcasts prompt lifecycle to multiple endpoints', async () => {
    const ctx = await createController();
    const editor = ctx.attachEndpoint('editor-1');
    await editor.markReady();
    ctx.messages.length = 0;
    editor.messages.length = 0;

    await (ctx.controller as any).handleSendPrompt('hello');

    assert.ok(ctx.messages.some(message => message.type === 'promptStart'));
    assert.ok(editor.messages.some(message => message.type === 'promptStart'));
    assert.ok(ctx.messages.some(message => message.type === 'promptEnd'));
    assert.ok(editor.messages.some(message => message.type === 'promptEnd'));
  });

  test('sharedStateChanged from sidebar hydrates editor endpoint', async () => {
    const ctx = await createController();
    const editor = ctx.attachEndpoint('editor-1');
    await editor.markReady();
    editor.messages.length = 0;

    await ctx.triggerMessage({
      type: 'sharedStateChanged',
      state: {
        ...emptySharedState(),
        version: 1,
        updatedAt: Date.now(),
        promptText: 'saved draft',
      },
    });

    const update = editor.messages.find(message => message.type === 'sharedStateUpdated');
    assert.ok(update);
    assert.strictEqual(update.state.promptText, 'saved draft');
  });

  test('orchestrationStateChanged from sidebar hydrates editor endpoint', async () => {
    const ctx = await createController();
    const editor = ctx.attachEndpoint('editor-1');
    await editor.markReady();
    editor.messages.length = 0;

    await ctx.triggerMessage({
      type: 'orchestrationStateChanged',
      state: {
        ...emptyOrchestrationState(),
        version: 1,
        updatedAt: Date.now(),
        activeRole: 'implementer',
        activeAgentName: 'builder',
      },
    });

    const update = editor.messages.find(message => message.type === 'orchestrationStateUpdated');
    assert.ok(update);
    assert.strictEqual(update.state.activeRole, 'implementer');
    assert.strictEqual(update.state.activeAgentName, 'builder');
  });

  test('clearChat clears shared and orchestration stores', async () => {
    const ctx = await createController();
    ctx.stateStore.updateFromWebview({
      ...emptySharedState(),
      version: 1,
      updatedAt: 100,
      promptText: 'draft',
      chatHistory: [{ kind: 'message', role: 'user', text: 'hello' }],
    }, 'view-1');
    ctx.orchestrationStateStore.updateFromWebview({
      ...emptyOrchestrationState(),
      version: 1,
      updatedAt: 100,
      activeRole: 'reviewer',
    }, 'view-1');

    const editor = ctx.attachEndpoint('editor-1');
    await editor.markReady();
    ctx.messages.length = 0;
    editor.messages.length = 0;

    ctx.controller.clearChat();

    assert.strictEqual(ctx.stateStore.getSnapshot().promptText, '');
    assert.strictEqual(ctx.orchestrationStateStore.getSnapshot().activeRole, null);
    assert.ok(ctx.messages.some(message => message.type === 'clearChat'));
    assert.ok(editor.messages.some(message => message.type === 'clearChat'));
    assert.ok(ctx.messages.some(message => message.type === 'hydrateOrchestrationState'));
  });

  test('sends raw prompt when editor context link is disabled', async () => {
    const { controller, sentPrompts, recordedPrompts } = await createController(editorContext);

    await (controller as any).handleSendPrompt('raw prompt');

    assert.deepStrictEqual(sentPrompts, ['raw prompt']);
    assert.deepStrictEqual(recordedPrompts, ['raw prompt']);
  });

  test('sendPrompt message records source text and sends expanded agent text', async () => {
    const { triggerMessage, sentPrompts, recordedPrompts } = await createController(editorContext);

    await triggerMessage({
      type: 'sendPrompt',
      text: 'Check [@index.ts](file://src/a/index.ts)',
      agentText: 'Check @src/a/index.ts',
    });

    assert.deepStrictEqual(recordedPrompts, ['Check [@index.ts](file://src/a/index.ts)']);
    assert.deepStrictEqual(sentPrompts, ['Check @src/a/index.ts']);
  });

  test('sends enriched prompt to agent and records only raw prompt', async () => {
    const { controller, sentPrompts, recordedPrompts, messages } = await createController(editorContext);
    controller.setEditorContextLinked(true);

    await (controller as any).handleSendPrompt('raw prompt');

    assert.strictEqual(sentPrompts.length, 1);
    assert.ok(sentPrompts[0].includes('VS Code context:'));
    assert.deepStrictEqual(recordedPrompts, ['raw prompt']);
    assert.strictEqual(messages.some(message => message.type === 'info'), false);
  });

  test('handleCancelTurn posts promptEnd after cancelTurn succeeds', async () => {
    let cancelCalled = false;
    const { controller, messages } = await createController();
    (controller as any).sessionManager.cancelTurn = async () => {
      cancelCalled = true;
    };
    messages.length = 0;

    await (controller as any).handleCancelTurn();

    assert.strictEqual(cancelCalled, true);
    assert.ok(messages.some(message => message.type === 'promptEnd' && message.stopReason === 'cancelled'));
  });

  test('handleSendPrompt with no activeSessionId posts error and does not call sendPrompt', async () => {
    const { controller, sentPrompts, messages } = await createController();
    (controller as any).sessionManager.getActiveSessionId = () => null;
    messages.length = 0;

    await (controller as any).handleSendPrompt('test prompt');

    assert.strictEqual(sentPrompts.length, 0);
    assert.ok(messages.some(m => m.type === 'error'));
  });

  test('handleSendPrompt ignores duplicate send while a turn is in flight', async () => {
    const { controller, sentPrompts } = await createController();
    let releasePrompt: (() => void) | undefined;
    const promptGate = new Promise<void>(resolve => {
      releasePrompt = resolve;
    });
    (controller as any).sessionManager.sendPrompt = async (_sessionId: string, prompt: string) => {
      sentPrompts.push(prompt);
      await promptGate;
      return { stopReason: 'end_turn' };
    };

    const first = (controller as any).handleSendPrompt('first prompt');
    const second = (controller as any).handleSendPrompt('second prompt');
    releasePrompt?.();
    await Promise.all([first, second]);

    assert.deepStrictEqual(sentPrompts, ['first prompt']);
  });

  test('postMessage queues messages until endpoint is ready', async () => {
    const ctx = await createController();
    const pending = ctx.attachEndpoint('view-2');

    (ctx.controller as any).postMessage({ type: 'test1' }, 'view-2');
    (ctx.controller as any).postMessage({ type: 'test2' }, 'view-2');

    assert.strictEqual(pending.messages.length, 0);
    await pending.markReady();
    assert.ok(pending.messages.some(message => message.type === 'test1'));
    assert.ok(pending.messages.some(message => message.type === 'test2'));
  });
});
