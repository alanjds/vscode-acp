import * as assert from 'assert';
import * as vscode from 'vscode';

import { AcpAgentRunner } from '../pipeline/AcpAgentRunner';
import { SandcastlePromotion } from '../sandcastle/SandcastlePromotion';
import { isRunAbortedError, RunAbortedError } from '../pipeline/RunAbortedError';

suite('RunAbortedError', () => {
  test('isRunAbortedError identifies RunAbortedError instances', () => {
    assert.strictEqual(isRunAbortedError(new RunAbortedError()), true);
    assert.strictEqual(isRunAbortedError(new Error('Run aborted.')), false);
  });
});

suite('AcpAgentRunner abort', () => {
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

  test('run throws RunAbortedError when signal is already aborted', async () => {
    const promotion = new SandcastlePromotion({} as any);
    const runner = new AcpAgentRunner(() => '/repo', promotion);
    const controller = new AbortController();
    controller.abort();

    await assert.rejects(
      () => runner.run('Codex', 'hello', { signal: controller.signal }),
      (error: unknown) => isRunAbortedError(error),
    );
  });
});
