import * as assert from 'assert';
import * as vscode from 'vscode';

import { SandcastleApplyError, SandcastlePromotion } from '../sandcastle/SandcastlePromotion';

suite('SandcastlePromotion', () => {
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

  test('rejects promotion when no session is active', async () => {
    const promotion = new SandcastlePromotion({ getActiveSession: () => undefined } as any);
    await assert.rejects(() => promotion.showDiff(), /No active ACP session/);
    await assert.rejects(() => promotion.apply(), /No active ACP session/);
    await assert.rejects(() => promotion.reject(), /No active ACP session/);
  });

  test('resolves the active Sandcastle session once for promotion actions', async () => {
    vscode.workspace.getConfiguration = () => ({
      get: (key: string, fallback?: unknown) => key === 'agents'
        ? { Sandbox: { transport: 'sandcastle', provider: 'codex', model: 'gpt-5' } }
        : fallback,
    }) as vscode.WorkspaceConfiguration;
    const calls: string[] = [];
    const connection = { extMethod: async () => ({}) };
    const sessions = {
      getActiveSession: () => ({ sessionId: 'sandbox-1', agentName: 'Sandbox' }),
      getConnectionForSession: (sessionId: string) => {
        calls.push(`connection:${sessionId}`);
        return { connection };
      },
    } as any;
    const ui = {
      apply: async (actualConnection: unknown, sessionId: string) => {
        assert.strictEqual(actualConnection, connection);
        calls.push(`apply:${sessionId}`);
      },
    } as any;

    await new SandcastlePromotion(sessions, ui).apply();

    assert.deepStrictEqual(calls, ['connection:sandbox-1', 'apply:sandbox-1']);
  });

  test('finishEphemeralRun discards silently when sideEffects is none', async () => {
    const calls: string[] = [];
    const ui = {
      discard: async () => {
        calls.push('discard');
      },
    } as any;

    const outcome = await new SandcastlePromotion({} as any, ui).finishEphemeralRun(
      { extMethod: async () => ({}) },
      'session-ephemeral',
      { sideEffects: 'none' },
    );

    assert.strictEqual(outcome, undefined);
    assert.deepStrictEqual(calls, ['discard']);
  });

  test('finishEphemeralRun promotes and discards when cancelled', async () => {
    const calls: string[] = [];
    const ui = {
      discard: async () => {
        calls.push('discard');
      },
    } as any;
    const promotion = new SandcastlePromotion({} as any, ui);
    promotion.promote = async () => 'cancelled';

    const outcome = await promotion.finishEphemeralRun(
      { extMethod: async () => ({}) },
      'session-cancelled',
      { sideEffects: 'workspace' },
    );

    assert.strictEqual(outcome, 'cancelled');
    assert.deepStrictEqual(calls, ['discard']);
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
    const promotion = new SandcastlePromotion({} as any);

    const outcome = await promotion.promote(connection, 'session-2');

    assert.strictEqual(outcome, 'no_changes');
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
    const promotion = new SandcastlePromotion({} as any);

    const outcome = await promotion.promote(connection, 'session-3');

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
    const promotion = new SandcastlePromotion({} as any);

    const outcome = await promotion.promote(connection, 'session-4');

    assert.strictEqual(outcome, 'applied');
    assert.deepStrictEqual(quickPickCalls, [3, 2]);
    assert.deepStrictEqual(calls, ['sandcastle/preview', 'sandcastle/apply']);
  });

  test('promote returns rejected when the user rejects changes', async () => {
    vscode.window.showQuickPick = async (items: any) =>
      items.find((item: any) => item.choice === 'reject');
    const calls: string[] = [];
    const connection = {
      extMethod: async (method: string) => {
        calls.push(method);
        return method === 'sandcastle/preview'
          ? { diff: 'diff', filesChanged: 1, branch: 'b', baseRef: 'main', worktreePath: '/tmp/wt' }
          : { success: true };
      },
    };

    assert.strictEqual(await new SandcastlePromotion({} as any).promote(connection, 'session-5'), 'rejected');
    assert.deepStrictEqual(calls, ['sandcastle/preview', 'sandcastle/reject']);
  });

  test('promote returns cancelled without rejecting when the picker closes', async () => {
    vscode.window.showQuickPick = async () => undefined;
    const calls: string[] = [];
    const connection = {
      extMethod: async (method: string) => {
        calls.push(method);
        return { diff: 'diff', filesChanged: 1, branch: 'b', baseRef: 'main', worktreePath: '/tmp/wt' };
      },
    };

    assert.strictEqual(await new SandcastlePromotion({} as any).promote(connection, 'session-6'), 'cancelled');
    assert.deepStrictEqual(calls, ['sandcastle/preview']);
  });

  test('promote throws SandcastleApplyError when apply fails', async () => {
    vscode.workspace.getConfiguration = () => ({
      get: (key: string, defaultValue?: unknown) => key === 'sandcastle.promotion' ? 'autoApply' : defaultValue,
    }) as vscode.WorkspaceConfiguration;
    const connection = {
      extMethod: async (method: string) => method === 'sandcastle/preview'
        ? { diff: 'diff', filesChanged: 1, branch: 'b', baseRef: 'main', worktreePath: '/tmp/wt' }
        : { success: false, message: 'Conflict.' },
    };

    await assert.rejects(
      () => new SandcastlePromotion({} as any).promote(connection, 'session-7'),
      (error: unknown) => error instanceof SandcastleApplyError,
    );
  });
});
