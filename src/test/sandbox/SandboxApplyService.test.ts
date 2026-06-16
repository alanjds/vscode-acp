import * as assert from 'assert';

import type { GitCommandRunner } from '../../sandbox/GitCommandRunner';
import { SandboxApplyService } from '../../sandbox/SandboxApplyService';
import type { SandboxContext } from '../../sandbox/SandboxContext';
import type { PromotionReport } from '../../sandbox/PromotionGate';

class MockGitRunner implements GitCommandRunner {
  public shouldFailApply = false;
  public readonly calls: Array<{ cwd: string; args: string[] }> = [];

  async exec(cwd: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
    this.calls.push({ cwd, args });
    if (args[0] === 'apply' && args[1] === '--check' && this.shouldFailApply) {
      throw new Error('patch does not apply');
    }
    return { stdout: '', stderr: '' };
  }
}

const CONTEXT: SandboxContext = {
  id: 'apply-id',
  root: '/sandbox',
  baseCwd: '/repo',
  baseRef: 'abc123',
  branch: 'sandbox/apply-id',
  createdAt: new Date().toISOString(),
};

suite('SandboxApplyService', () => {
  test('apply returns success for empty diff', async () => {
    const service = new SandboxApplyService(new MockGitRunner());
    const report: PromotionReport = {
      diff: '',
      filesChanged: 0,
      checks: [],
      checksPassed: true,
    };

    const result = await service.apply(CONTEXT, report);
    assert.strictEqual(result.success, true);
    assert.match(result.message, /No changes/);
  });

  test('apply runs git apply check and apply', async () => {
    const git = new MockGitRunner();
    const service = new SandboxApplyService(git);
    const report: PromotionReport = {
      diff: 'diff --git a/file.ts\n',
      filesChanged: 1,
      checks: [],
      checksPassed: true,
    };

    const result = await service.apply(CONTEXT, report);
    assert.strictEqual(result.success, true);
    assert.ok(git.calls.some(call => call.args[0] === 'apply' && call.args[1] === '--check'));
    assert.ok(git.calls.some(call => call.args[0] === 'apply' && call.args[1] !== '--check'));
  });

  test('apply reports failure when patch does not apply', async () => {
    const git = new MockGitRunner();
    git.shouldFailApply = true;
    const service = new SandboxApplyService(git);
    const report: PromotionReport = {
      diff: 'diff --git a/file.ts\n',
      filesChanged: 1,
      checks: [],
      checksPassed: true,
    };

    const result = await service.apply(CONTEXT, report);
    assert.strictEqual(result.success, false);
    assert.match(result.message, /Failed to apply/);
  });
});
