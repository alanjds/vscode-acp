import * as assert from 'assert';
import { EventEmitter } from 'node:events';

import {
  AgentTreeItem,
  InfoTreeItem,
  SessionTreeItem,
  SessionTreeProvider,
} from '../ui/SessionTreeProvider';

class FakeSessionManager extends EventEmitter {
  public cachedCaps = new Map<string, { list: boolean; load: boolean; resume: boolean }>();
  public activeSessionId: string | null = null;
  public connected = new Set<string>();

  public listSessionsImpl: (agentName: string, opts: { cwd?: string; cursor?: string }) => Promise<{ sessions: any[]; nextCursor?: string }> = async () => ({ sessions: [] });

  getCachedCapabilities(agentName: string) {
    return this.cachedCaps.get(agentName);
  }

  isAgentConnected(agentName: string): boolean {
    return this.connected.has(agentName);
  }

  getActiveSessionId(): string | null {
    return this.activeSessionId;
  }

  async ensureConnected(): Promise<void> {
    return;
  }

  async listSessions(agentName: string, opts: { cwd?: string; cursor?: string }) {
    return this.listSessionsImpl(agentName, opts);
  }
}

function waitNextTick(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 0));
}

suite('SessionTreeProvider', () => {
  test('returns unsupported info leaf when agent has no session capabilities', async () => {
    const sm = new FakeSessionManager();
    sm.cachedCaps.set('agent-a', { list: false, load: false, resume: false });

    const provider = new SessionTreeProvider(
      sm as any,
      null,
      () => '/repo',
    );

    const children = await provider.getChildren(new AgentTreeItem('agent-a', false, 1));
    assert.strictEqual(children.length, 1);
    assert.ok(children[0] instanceof InfoTreeItem);
    assert.strictEqual((children[0] as InfoTreeItem).kind, 'unsupported');
  });

  test('returns local sessions when load/resume is available without list', async () => {
    const sm = new FakeSessionManager();
    sm.cachedCaps.set('agent-a', { list: false, load: true, resume: false });

    const historyStore = {
      list: (agentName: string, cwd?: string) => {
        if (agentName === 'agent-a' && cwd === '/repo') {
          return [
            {
              agentName: 'agent-a',
              sessionId: 's-local',
              cwd: '/repo',
              firstPrompt: 'Prompt',
              createdAt: '2026-01-01T00:00:00.000Z',
              lastActiveAt: '2026-01-01T00:00:00.000Z',
            },
          ];
        }
        return [];
      },
      onDidChange: () => ({ dispose: () => undefined }),
    };

    const provider = new SessionTreeProvider(
      sm as any,
      historyStore as any,
      () => '/repo',
    );

    const children = await provider.getChildren(new AgentTreeItem('agent-a', false, 1));
    assert.strictEqual(children.length, 1);
    assert.ok(children[0] instanceof SessionTreeItem);
    assert.strictEqual((children[0] as SessionTreeItem).source, 'local');
  });

  test('agent-sourced list transitions from loading to ready', async () => {
    const sm = new FakeSessionManager();
    sm.cachedCaps.set('agent-a', { list: true, load: false, resume: false });
    sm.listSessionsImpl = async () => ({
      sessions: [
        {
          sessionId: 's1',
          title: 'Session One',
          cwd: '/repo',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    });

    const provider = new SessionTreeProvider(sm as any, null, () => '/repo');
    const agentNode = new AgentTreeItem('agent-a', false, 1);

    const first = await provider.getChildren(agentNode);
    assert.strictEqual(first.length, 1);
    assert.ok(first[0] instanceof InfoTreeItem);
    assert.strictEqual((first[0] as InfoTreeItem).kind, 'loading');

    await waitNextTick();

    const second = await provider.getChildren(agentNode);
    assert.strictEqual(second.length, 1);
    assert.ok(second[0] instanceof SessionTreeItem);
    assert.strictEqual((second[0] as SessionTreeItem).source, 'agent');
    assert.strictEqual((second[0] as SessionTreeItem).sessionId, 's1');
  });

  test('list auth error becomes auth-required leaf', async () => {
    const sm = new FakeSessionManager();
    sm.cachedCaps.set('agent-a', { list: true, load: false, resume: false });
    sm.listSessionsImpl = async () => {
      throw new Error('authentication required');
    };

    const provider = new SessionTreeProvider(sm as any, null, () => '/repo');
    const agentNode = new AgentTreeItem('agent-a', false, 1);

    await provider.getChildren(agentNode);
    await waitNextTick();
    const children = await provider.getChildren(agentNode);

    assert.strictEqual(children.length, 1);
    assert.ok(children[0] instanceof InfoTreeItem);
    assert.strictEqual((children[0] as InfoTreeItem).kind, 'auth-required');
  });

  test('loadMore appends next page from cursor', async () => {
    const sm = new FakeSessionManager();
    sm.cachedCaps.set('agent-a', { list: true, load: false, resume: false });
    sm.listSessionsImpl = async (_agentName, opts) => {
      if (!opts.cursor) {
        return {
          sessions: [
            {
              sessionId: 's1',
              title: 'Session One',
              cwd: '/repo',
              updatedAt: '2026-01-01T00:00:00.000Z',
            },
          ],
          nextCursor: 'cursor-2',
        };
      }
      return {
        sessions: [
          {
            sessionId: 's2',
            title: 'Session Two',
            cwd: '/repo',
            updatedAt: '2026-01-02T00:00:00.000Z',
          },
        ],
      };
    };

    const provider = new SessionTreeProvider(sm as any, null, () => '/repo');
    const agentNode = new AgentTreeItem('agent-a', false, 1);

    await provider.getChildren(agentNode);
    await waitNextTick();
    const beforeLoadMore = await provider.getChildren(agentNode);
    assert.strictEqual(beforeLoadMore.filter(c => c instanceof SessionTreeItem).length, 1);

    await provider.loadMore('agent-a');

    const afterLoadMore = await provider.getChildren(agentNode);
    const sessions = afterLoadMore.filter(c => c instanceof SessionTreeItem) as SessionTreeItem[];
    assert.strictEqual(sessions.length, 2);
    assert.strictEqual(sessions[0].sessionId, 's1');
    assert.strictEqual(sessions[1].sessionId, 's2');
  });
});