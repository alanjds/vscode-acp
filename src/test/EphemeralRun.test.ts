import * as assert from 'assert';
import * as vscode from 'vscode';

import { runEphemeralRun } from '../core/EphemeralRun';
import { isRunAbortedError, RunAbortedError } from '../core/RunAbortedError';

suite('RunAbortedError', () => {
  test('isRunAbortedError identifies RunAbortedError instances', () => {
    assert.strictEqual(isRunAbortedError(new RunAbortedError()), true);
    assert.strictEqual(isRunAbortedError(new Error('Run aborted.')), false);
  });
});

suite('EphemeralRun abort', () => {
  let originalGetConfiguration: typeof vscode.workspace.getConfiguration;

  setup(() => {
    originalGetConfiguration = vscode.workspace.getConfiguration;
    vscode.workspace.getConfiguration = function() {
      return {
        get: (key: string, defaultValue?: unknown) => {
          if (key === 'agents') {
            return { Codex: { command: 'echo' } };
          }
          return defaultValue;
        },
      } as any;
    };
  });

  teardown(() => {
    vscode.workspace.getConfiguration = originalGetConfiguration;
  });

  test('runEphemeralRun throws RunAbortedError when signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();

    await assert.rejects(
      () => runEphemeralRun({
        workspaceCwd: '/repo',
        agentName: 'Codex',
        promptText: 'hello',
        signal: controller.signal,
      }),
      (error: unknown) => isRunAbortedError(error),
    );
  });
});
