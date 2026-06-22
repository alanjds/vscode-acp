import * as assert from 'assert';

import { SandcastlePromotionUi } from '../../sandcastle/SandcastlePromotionUi';

suite('SandcastlePromotionUi', () => {
  test('discard calls sandcastle/reject without UI', async () => {
    const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
    const connection = {
      extMethod: async (method: string, params: Record<string, unknown>) => {
        calls.push({ method, params });
        return { success: true };
      },
    };
    const ui = new SandcastlePromotionUi();

    await ui.discard(connection, 'session-1');

    assert.strictEqual(calls.length, 1);
    assert.strictEqual(calls[0]?.method, 'sandcastle/reject');
    assert.strictEqual(calls[0]?.params.sessionId, 'session-1');
  });

  test('promote auto-discards when there are no file changes', async () => {
    const calls: string[] = [];
    const connection = {
      extMethod: async (method: string) => {
        calls.push(method);
        if (method === 'sandcastle/preview') {
          return { diff: '', filesChanged: 0, branch: 'b', baseRef: 'main', worktreePath: '/tmp/wt' };
        }
        return { success: true };
      },
    };
    const ui = new SandcastlePromotionUi();

    const outcome = await ui.promote(connection, 'session-2');

    assert.strictEqual(outcome, 'rejected');
    assert.deepStrictEqual(calls, ['sandcastle/preview', 'sandcastle/reject']);
  });
});
