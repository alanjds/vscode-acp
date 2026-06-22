import * as assert from 'assert';
import * as vscode from 'vscode';

import { SandcastlePromotionUi } from '../../sandcastle/SandcastlePromotionUi';

suite('SandcastlePromotionUi', () => {
  let originalShowQuickPick: typeof vscode.window.showQuickPick;
  let originalGetConfiguration: typeof vscode.workspace.getConfiguration;

  setup(() => {
    originalShowQuickPick = vscode.window.showQuickPick;
    originalGetConfiguration = vscode.workspace.getConfiguration;
  });

  teardown(() => {
    vscode.window.showQuickPick = originalShowQuickPick;
    vscode.workspace.getConfiguration = originalGetConfiguration;
  });

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

  test('promote autoApply skips the promotion UI', async () => {
    const calls: string[] = [];
    vscode.workspace.getConfiguration = () => ({
      get: (key: string, defaultValue?: unknown) => {
        if (key === 'sandcastle.promotion') {
          return 'autoApply';
        }
        return defaultValue;
      },
    }) as vscode.WorkspaceConfiguration;

    const connection = {
      extMethod: async (method: string) => {
        calls.push(method);
        if (method === 'sandcastle/preview') {
          return {
            diff: 'diff',
            filesChanged: 1,
            branch: 'b',
            baseRef: 'main',
            worktreePath: '/tmp/wt',
          };
        }
        return { success: true, message: 'Applied.' };
      },
    };
    const ui = new SandcastlePromotionUi();

    const outcome = await ui.promote(connection, 'session-3');

    assert.strictEqual(outcome, 'applied');
    assert.deepStrictEqual(calls, ['sandcastle/preview', 'sandcastle/apply']);
  });

  test('promote ask shows apply/reject only once after viewing diff', async () => {
    const quickPickCalls: number[] = [];
    vscode.workspace.getConfiguration = () => ({
      get: (key: string, defaultValue?: unknown) => {
        if (key === 'sandcastle.promotion') {
          return 'ask';
        }
        return defaultValue;
      },
    }) as vscode.WorkspaceConfiguration;

    vscode.window.showQuickPick = async (items: any) => {
      quickPickCalls.push(items.length);
      if (quickPickCalls.length === 1) {
        return items.find((item: any) => item.choice === 'diff');
      }
      return items.find((item: any) => item.choice === 'apply');
    };

    const calls: string[] = [];
    const connection = {
      extMethod: async (method: string) => {
        calls.push(method);
        if (method === 'sandcastle/preview') {
          return {
            diff: 'diff',
            filesChanged: 1,
            branch: 'b',
            baseRef: 'main',
            worktreePath: '/tmp/wt',
          };
        }
        return { success: true, message: 'Applied.' };
      },
    };
    const ui = new SandcastlePromotionUi();

    const outcome = await ui.promote(connection, 'session-4');

    assert.strictEqual(outcome, 'applied');
    assert.deepStrictEqual(quickPickCalls, [3, 2]);
    assert.deepStrictEqual(calls, ['sandcastle/preview', 'sandcastle/apply']);
  });
});
