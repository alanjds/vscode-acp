import * as assert from 'assert';
import * as vscode from 'vscode';

import { OrchestrationWebviewStateStore } from '../ui/OrchestrationWebviewStateStore';
import { emptyOrchestrationState } from '../ui/OrchestrationState';

suite('OrchestrationWebviewStateStore', () => {
  function createStore(initial?: unknown) {
    const updates: unknown[] = [];
    const memento = {
      get: (_key: string) => initial,
      update: async (_key: string, value: unknown) => {
        updates.push(value);
      },
      keys: () => [],
    } as unknown as vscode.Memento;

    const store = new OrchestrationWebviewStateStore(memento);
    return { store, updates };
  }

  test('updateFromWebview ignores stale snapshots', () => {
    const { store } = createStore({
      ...emptyOrchestrationState(),
      version: 5,
      updatedAt: 500,
      activeRole: 'implementer',
    });

    const applied = store.updateFromWebview({
      ...emptyOrchestrationState(),
      version: 4,
      updatedAt: 400,
      activeRole: 'reviewer',
    }, 'view-1');

    assert.strictEqual(applied, false);
    assert.strictEqual(store.getSnapshot().activeRole, 'implementer');
  });

  test('updateFromWebview persists newer snapshot and notifies listeners', async () => {
    const { store, updates } = createStore(emptyOrchestrationState());
    let notified = false;

    store.onDidChange((snapshot, sourceEndpointId) => {
      notified = true;
      assert.strictEqual(sourceEndpointId, 'view-1');
      assert.strictEqual(snapshot.activeRole, 'planner');
    });

    const applied = store.updateFromWebview({
      ...emptyOrchestrationState(),
      version: 1,
      updatedAt: 100,
      activeRole: 'planner',
    }, 'view-1');

    assert.strictEqual(applied, true);
    assert.strictEqual(notified, true);
    await new Promise(resolve => setTimeout(resolve, 200));
    assert.ok(updates.length > 0);
  });

  test('clear resets snapshot', () => {
    const { store } = createStore({
      ...emptyOrchestrationState(),
      activeRole: 'reviewer',
      timeline: [{ id: 'planner', label: 'Planner', status: 'done' }],
    });

    store.clear();
    const snapshot = store.getSnapshot();
    assert.strictEqual(snapshot.activeRole, null);
    assert.deepStrictEqual(snapshot.timeline, []);
  });
});
