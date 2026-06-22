import * as assert from 'assert';
import * as vscode from 'vscode';

import { SandcastlePromotion } from '../sandcastle/SandcastlePromotion';

suite('SandcastlePromotion', () => {
  let originalGetConfiguration: typeof vscode.workspace.getConfiguration;

  setup(() => {
    originalGetConfiguration = vscode.workspace.getConfiguration;
  });

  teardown(() => {
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
});
