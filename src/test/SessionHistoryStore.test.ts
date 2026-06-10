import * as assert from 'assert';

import {
  SessionHistoryStore,
  type PersistedSessionEntry,
} from '../core/SessionHistoryStore';

const STATE_KEY = 'acp.sessionHistory.v1';

type PersistedShape = {
  version: 1;
  entries: PersistedSessionEntry[];
};

class FakeMemento {
  private data = new Map<string, unknown>();

  constructor(initial?: PersistedShape) {
    if (initial) {
      this.data.set(STATE_KEY, initial);
    }
  }

  get<T>(key: string): T | undefined {
    return this.data.get(key) as T | undefined;
  }

  update(key: string, value: unknown): Thenable<void> {
    this.data.set(key, value);
    return Promise.resolve();
  }
}

suite('SessionHistoryStore', () => {
  test('loads persisted entries and lists by lastActiveAt desc', () => {
    const memento = new FakeMemento({
      version: 1,
      entries: [
        {
          agentName: 'A',
          cwd: '/repo',
          sessionId: 's1',
          createdAt: '2026-01-01T00:00:00.000Z',
          lastActiveAt: '2026-01-01T00:00:00.000Z',
        },
        {
          agentName: 'A',
          cwd: '/repo',
          sessionId: 's2',
          createdAt: '2026-02-01T00:00:00.000Z',
          lastActiveAt: '2026-02-01T00:00:00.000Z',
        },
        {
          agentName: 'B',
          cwd: '/repo',
          sessionId: 's3',
          createdAt: '2026-03-01T00:00:00.000Z',
          lastActiveAt: '2026-03-01T00:00:00.000Z',
        },
      ],
    });

    const store = new SessionHistoryStore(memento as any);

    const entriesA = store.list('A', '/repo');
    assert.strictEqual(entriesA.length, 2);
    assert.strictEqual(entriesA[0].sessionId, 's2');
    assert.strictEqual(entriesA[1].sessionId, 's1');
    assert.strictEqual(store.list('A', '/other').length, 0);
  });

  test('upsertNew inserts a new entry and emits change', () => {
    const memento = new FakeMemento();
    const store = new SessionHistoryStore(memento as any);
    let events = 0;

    store.onDidChange(() => {
      events += 1;
    });

    store.upsertNew('A', '/repo', 's-new');

    const entry = store.get('A', 's-new');
    assert.ok(entry);
    assert.strictEqual(entry?.agentName, 'A');
    assert.strictEqual(entry?.cwd, '/repo');
    assert.strictEqual(events, 1);
  });

  test('upsertNew on existing session does not duplicate entries', () => {
    const memento = new FakeMemento({
      version: 1,
      entries: [
        {
          agentName: 'A',
          cwd: '/repo',
          sessionId: 's1',
          createdAt: '2026-01-01T00:00:00.000Z',
          lastActiveAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    });
    const store = new SessionHistoryStore(memento as any);

    store.upsertNew('A', '/repo', 's1');

    assert.strictEqual(store.list('A').length, 1);
  });

  test('enforces cap per agent', () => {
    const memento = new FakeMemento({
      version: 1,
      entries: [
        {
          agentName: 'A',
          cwd: '/repo',
          sessionId: 'oldest',
          createdAt: '2026-01-01T00:00:00.000Z',
          lastActiveAt: '2026-01-01T00:00:00.000Z',
        },
        {
          agentName: 'A',
          cwd: '/repo',
          sessionId: 'newer',
          createdAt: '2026-02-01T00:00:00.000Z',
          lastActiveAt: '2026-02-01T00:00:00.000Z',
        },
      ],
    });
    const store = new SessionHistoryStore(memento as any, 2);

    store.upsertNew('A', '/repo', 'newest');

    const ids = store.list('A').map(e => e.sessionId);
    assert.strictEqual(ids.length, 2);
    assert.ok(ids.includes('newer'));
    assert.ok(ids.includes('newest'));
    assert.ok(!ids.includes('oldest'));
  });

  test('setTitle supports setting and clearing title', () => {
    const memento = new FakeMemento({
      version: 1,
      entries: [
        {
          agentName: 'A',
          cwd: '/repo',
          sessionId: 's1',
          title: 'Old',
          createdAt: '2026-01-01T00:00:00.000Z',
          lastActiveAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    });
    const store = new SessionHistoryStore(memento as any);

    store.setTitle('A', 's1', 'New');
    assert.strictEqual(store.get('A', 's1')?.title, 'New');

    store.setTitle('A', 's1', null);
    assert.strictEqual(store.get('A', 's1')?.title, undefined);
  });

  test('setFirstPromptIfMissing truncates and does not overwrite', () => {
    const memento = new FakeMemento({
      version: 1,
      entries: [
        {
          agentName: 'A',
          cwd: '/repo',
          sessionId: 's1',
          createdAt: '2026-01-01T00:00:00.000Z',
          lastActiveAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    });
    const store = new SessionHistoryStore(memento as any);

    store.setFirstPromptIfMissing('A', 's1', 'x'.repeat(200));
    const first = store.get('A', 's1')?.firstPrompt;
    assert.ok(first);
    assert.strictEqual(first?.length, 120);

    store.setFirstPromptIfMissing('A', 's1', 'should-not-overwrite');
    assert.strictEqual(store.get('A', 's1')?.firstPrompt, first);
  });

  test('touch updates lastActiveAt', () => {
    const memento = new FakeMemento({
      version: 1,
      entries: [
        {
          agentName: 'A',
          cwd: '/repo',
          sessionId: 's1',
          createdAt: '2026-01-01T00:00:00.000Z',
          lastActiveAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    });
    const store = new SessionHistoryStore(memento as any);

    const before = store.get('A', 's1')?.lastActiveAt;
    store.touch('A', 's1');
    const after = store.get('A', 's1')?.lastActiveAt;

    assert.ok(before);
    assert.ok(after);
    assert.notStrictEqual(after, before);
  });

  test('forget and forgetAgent remove entries', () => {
    const memento = new FakeMemento({
      version: 1,
      entries: [
        {
          agentName: 'A',
          cwd: '/repo',
          sessionId: 's1',
          createdAt: '2026-01-01T00:00:00.000Z',
          lastActiveAt: '2026-01-01T00:00:00.000Z',
        },
        {
          agentName: 'A',
          cwd: '/repo',
          sessionId: 's2',
          createdAt: '2026-01-02T00:00:00.000Z',
          lastActiveAt: '2026-01-02T00:00:00.000Z',
        },
        {
          agentName: 'B',
          cwd: '/repo',
          sessionId: 's3',
          createdAt: '2026-01-03T00:00:00.000Z',
          lastActiveAt: '2026-01-03T00:00:00.000Z',
        },
      ],
    });
    const store = new SessionHistoryStore(memento as any);

    assert.strictEqual(store.forget('A', 's1'), true);
    assert.strictEqual(store.get('A', 's1'), undefined);

    assert.strictEqual(store.forgetAgent('A'), 1);
    assert.strictEqual(store.list('A').length, 0);
    assert.strictEqual(store.list('B').length, 1);
  });

  test('reconcileFromAgent prunes unknown sessions for one agent only', () => {
    const memento = new FakeMemento({
      version: 1,
      entries: [
        {
          agentName: 'A',
          cwd: '/repo',
          sessionId: 'keep',
          createdAt: '2026-01-01T00:00:00.000Z',
          lastActiveAt: '2026-01-01T00:00:00.000Z',
        },
        {
          agentName: 'A',
          cwd: '/repo',
          sessionId: 'drop',
          createdAt: '2026-01-02T00:00:00.000Z',
          lastActiveAt: '2026-01-02T00:00:00.000Z',
        },
        {
          agentName: 'B',
          cwd: '/repo',
          sessionId: 'other-agent',
          createdAt: '2026-01-03T00:00:00.000Z',
          lastActiveAt: '2026-01-03T00:00:00.000Z',
        },
      ],
    });
    const store = new SessionHistoryStore(memento as any);

    store.reconcileFromAgent('A', new Set(['keep']));

    assert.strictEqual(store.get('A', 'keep')?.sessionId, 'keep');
    assert.strictEqual(store.get('A', 'drop'), undefined);
    assert.strictEqual(store.get('B', 'other-agent')?.sessionId, 'other-agent');
  });
});