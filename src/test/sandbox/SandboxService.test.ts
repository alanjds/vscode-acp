import * as assert from 'assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import type { GitCommandRunner } from '../../sandbox/GitCommandRunner';
import { SandboxRegistry } from '../../sandbox/SandboxRegistry';
import { SandboxService } from '../../sandbox/SandboxService';

class MockGitRunner implements GitCommandRunner {
  public readonly calls: Array<{ cwd: string; args: string[] }> = [];
  private readonly responses = new Map<string, string>();

  setResponse(key: string, stdout: string): void {
    this.responses.set(key, stdout);
  }

  async exec(cwd: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
    this.calls.push({ cwd, args });
    const key = args.join(' ');
    if (key === 'rev-parse --git-dir') {
      return { stdout: '.git\n', stderr: '' };
    }
    if (key === 'rev-parse HEAD') {
      return { stdout: 'abc123\n', stderr: '' };
    }
    if (this.responses.has(key)) {
      return { stdout: this.responses.get(key)!, stderr: '' };
    }
    return { stdout: '', stderr: '' };
  }
}

suite('SandboxService', () => {
  let tempDir: string;

  setup(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'acp-sandbox-test-'));
  });

  teardown(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  test('create registers a sandbox worktree', async () => {
    const git = new MockGitRunner();
    const registry = new SandboxRegistry();
    const service = new SandboxService(registry, git);

    const context = await service.create(tempDir);

    assert.ok(context.id.length > 0);
    assert.ok(context.root.includes(path.join('.acp', 'sandboxes', context.id)));
    assert.strictEqual(context.baseCwd, path.resolve(tempDir));
    assert.strictEqual(context.baseRef, 'abc123');
    assert.strictEqual(registry.getActive()?.id, context.id);
    assert.ok(git.calls.some(call => call.args[0] === 'worktree'));
  });

  test('destroy removes worktree and registry entry', async () => {
    const git = new MockGitRunner();
    const registry = new SandboxRegistry();
    const service = new SandboxService(registry, git);
    const context = await service.create(tempDir);

    await service.destroy(context);

    assert.strictEqual(registry.get(context.id), undefined);
    assert.ok(git.calls.some(call => call.args.includes('remove')));
    assert.ok(git.calls.some(call => call.args.includes('prune')));
  });

  test('create throws when cwd is not a git repo', async () => {
    const git: GitCommandRunner = {
      async exec() {
        throw new Error('not a git repository');
      },
    };
    const service = new SandboxService(new SandboxRegistry(), git);

    await assert.rejects(
      () => service.create(tempDir),
      /requires a git repository/,
    );
  });

  test('cleanupStale removes old sandboxes', async () => {
    const git = new MockGitRunner();
    const registry = new SandboxRegistry();
    const service = new SandboxService(registry, git);
    const context = await service.create(tempDir);
    context.createdAt = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
    registry.register(context);

    const removed = await service.cleanupStale(24 * 60 * 60 * 1000);
    assert.strictEqual(removed, 1);
    assert.strictEqual(registry.get(context.id), undefined);
  });
});
