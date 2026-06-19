import * as assert from 'assert';
import * as vscode from 'vscode';

import { ChatWebviewStateStore } from '../ui/ChatWebviewStateStore';
import { emptySharedState } from '../ui/ChatWebviewSharedState';

suite('ChatWebviewStateStore', () => {
  function createStore(initial?: unknown) {
    const updates: unknown[] = [];
    const memento = {
      get: (_key: string) => initial,
      update: async (_key: string, value: unknown) => {
        updates.push(value);
      },
      keys: () => [],
    } as unknown as vscode.Memento;

    const store = new ChatWebviewStateStore(memento);
    return { store, updates };
  }

  test('updateFromWebview ignores stale snapshots', () => {
    const { store } = createStore({
      ...emptySharedState(),
      version: 5,
      updatedAt: 500,
      promptText: 'current',
    });

    const applied = store.updateFromWebview({
      ...emptySharedState(),
      version: 4,
      updatedAt: 400,
      promptText: 'stale',
    }, 'view-1');

    assert.strictEqual(applied, false);
    assert.strictEqual(store.getSnapshot().promptText, 'current');
  });

  test('updateFromWebview persists newer snapshot and notifies listeners', async () => {
    const { store, updates } = createStore(emptySharedState());
    let notified = false;

    store.onDidChange((snapshot, sourceEndpointId) => {
      notified = true;
      assert.strictEqual(sourceEndpointId, 'view-1');
      assert.strictEqual(snapshot.promptText, 'draft');
    });

    const applied = store.updateFromWebview({
      ...emptySharedState(),
      version: 1,
      updatedAt: 100,
      promptText: 'draft',
    }, 'view-1');

    assert.strictEqual(applied, true);
    assert.strictEqual(notified, true);
    await new Promise(resolve => setTimeout(resolve, 200));
    assert.ok(updates.length > 0);
  });

  test('clear resets snapshot', () => {
    const { store } = createStore({
      ...emptySharedState(),
      promptText: 'draft',
      chatHistory: [{ kind: 'message', role: 'user', text: 'hello' }],
    });

    store.clear();
    const snapshot = store.getSnapshot();
    assert.strictEqual(snapshot.promptText, '');
    assert.deepStrictEqual(snapshot.chatHistory, []);
  });
});
