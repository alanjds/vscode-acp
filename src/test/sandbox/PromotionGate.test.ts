import * as assert from 'assert';
import * as vscode from 'vscode';

import type { GitCommandRunner } from '../../sandbox/GitCommandRunner';
import { PromotionGate } from '../../sandbox/PromotionGate';
import type { SandboxContext } from '../../sandbox/SandboxContext';

class MockGitRunner implements GitCommandRunner {
  public readonly calls: Array<{ cwd: string; args: string[] }> = [];

  async exec(cwd: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
    this.calls.push({ cwd, args });
    const key = args.join(' ');
    if (key.startsWith('diff --name-only')) {
      return { stdout: 'src/a.ts\nsrc/new.ts\n', stderr: '' };
    }
    if (key.startsWith('diff --binary ')) {
      return { stdout: 'diff --git a/src/new.ts b/src/new.ts\nnew file mode 100644\n+change\n', stderr: '' };
    }
    return { stdout: '', stderr: '' };
  }
}

const CONTEXT: SandboxContext = {
  id: 'test-id',
  root: '/sandbox',
  baseCwd: '/repo',
  baseRef: 'abc123',
  branch: 'sandbox/test-id',
  createdAt: new Date().toISOString(),
};

suite('PromotionGate', () => {
  let originalGetConfiguration: typeof vscode.workspace.getConfiguration;

  setup(() => {
    originalGetConfiguration = vscode.workspace.getConfiguration;
    vscode.workspace.getConfiguration = function(section?: string) {
      if (section === 'acp.sandbox') {
        return {
          get: (key: string, defaultValue?: unknown) => {
            if (key === 'promotion.lintCommand') {
              return '';
            }
            if (key === 'promotion.testCommand') {
              return '';
            }
            return defaultValue;
          },
        } as any;
      }
      return originalGetConfiguration(section);
    };
  });

  teardown(() => {
    vscode.workspace.getConfiguration = originalGetConfiguration;
  });

  test('evaluate collects diff and file stats', async () => {
    const git = new MockGitRunner();
    const gate = new PromotionGate(git);
    const report = await gate.evaluate(CONTEXT);

    assert.strictEqual(report.filesChanged, 2);
    assert.ok(report.diff.includes('diff --git'));
    assert.strictEqual(report.checks.length, 0);
    assert.strictEqual(report.checksPassed, true);
    assert.deepStrictEqual(git.calls[0]?.args, ['add', '--intent-to-add', '--', '.']);
    assert.ok(git.calls.some(call => call.args[0] === 'diff' && call.args.includes('--binary')));
  });
});
