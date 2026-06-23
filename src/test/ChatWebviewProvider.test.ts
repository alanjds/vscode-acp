import * as assert from 'assert';
import * as path from 'path';
import * as vscode from 'vscode';

import { ChatWebviewController } from '../ui/ChatWebviewController';
import { ChatWebviewProvider } from '../ui/ChatWebviewProvider';
import { ChatWebviewStateStore } from '../ui/ChatWebviewStateStore';
import { OrchestrationWebviewStateStore } from '../ui/OrchestrationWebviewStateStore';

suite('ChatWebviewProvider', () => {
  test('resolveWebviewView attaches sidebar endpoint to controller', async () => {
    const workspaceRoot = path.join(path.parse(process.cwd()).root, 'workspace');
    const sessionManager = {
      getActiveSessionId: () => null,
      getSession: () => null,
      getSessionContextFamily: () => null,
      hasPendingSharedDiscussionContext: () => false,
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
    );
    const provider = new ChatWebviewProvider(controller);

    const messages: any[] = [];
    let messageHandler: (m: any) => Promise<void> = async () => {};
    const webviewView = {
      webview: {
        options: {},
        html: '',
        postMessage: (message: any) => {
          messages.push(message);
          return Promise.resolve(true);
        },
        onDidReceiveMessage: (handler: any) => {
          messageHandler = handler;
          return { dispose: () => {} };
        },
      },
      onDidDispose: () => ({ dispose: () => {} }),
      visible: true,
    };

    (controller as any).getHtmlContent = async () => '<html></html>';

    await provider.resolveWebviewView(webviewView as any, {} as any, {} as any);
    await messageHandler({ type: 'ready' });

    assert.ok(messages.some(message => message.type === 'hydrateSharedState'));
    assert.ok(messages.some(message => message.type === 'state'));
  });

  test('delegates clearChat to controller', () => {
    const workspaceRoot = path.join(path.parse(process.cwd()).root, 'workspace');
    const sessionManager = {
      getActiveSessionId: () => null,
      getSession: () => null,
      getSessionContextFamily: () => null,
      hasPendingSharedDiscussionContext: () => false,
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
    );
    const provider = new ChatWebviewProvider(controller);

    stateStore.updateFromWebview({
      version: 1,
      updatedAt: 100,
      chatHistory: [{ kind: 'message', role: 'user', text: 'hello' }],
      sessionState: null,
      hasActiveSession: true,
      promptText: 'draft',
      inputAreaHeight: 140,
      isProcessing: false,
      currentTurn: null,
      collapsedTools: {},
    }, 'view-1');

    assert.strictEqual(provider.hasChatContent, true);
    provider.clearChat();
    assert.strictEqual(provider.hasChatContent, false);
  });
});
