import * as assert from 'assert';
import * as path from 'path';
import * as vscode from 'vscode';

import { ChatEditorPanelManager } from '../ui/ChatEditorPanelManager';
import { ChatWebviewController } from '../ui/ChatWebviewController';
import { ChatWebviewStateStore } from '../ui/ChatWebviewStateStore';
import { OrchestrationWebviewStateStore } from '../ui/OrchestrationWebviewStateStore';
import { emptySharedState } from '../ui/ChatWebviewSharedState';

suite('ChatEditorPanelManager', () => {
  function createManager() {
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
      vscode.Uri.file(path.join(path.parse(process.cwd()).root, 'workspace')),
      sessionManager as any,
      sessionUpdateHandler as any,
      stateStore,
      orchestrationStateStore,
    );
    const manager = new ChatEditorPanelManager(controller, stateStore);
    return { manager, stateStore, controller };
  }

  test('deserializeWebviewPanel hydrates store from serializer state', async () => {
    const { manager, stateStore, controller } = createManager();
    const messages: any[] = [];
    let disposed = false;

    const panel = {
      webview: {
        options: {},
        html: '',
        postMessage: (message: any) => {
          messages.push(message);
          return Promise.resolve(true);
        },
        onDidReceiveMessage: () => ({ dispose: () => {} }),
      },
      onDidDispose: (handler: () => void) => {
        return { dispose: () => { disposed = true; handler(); } };
      },
    } as unknown as vscode.WebviewPanel;

    (controller as any).getHtmlContent = async () => '<html></html>';

    await manager.deserializeWebviewPanel(panel, {
      ...emptySharedState(),
      version: 3,
      updatedAt: 300,
      promptText: 'restored draft',
    });

    assert.strictEqual(stateStore.getSnapshot().promptText, 'restored draft');
    assert.strictEqual(disposed, false);
  });
});
