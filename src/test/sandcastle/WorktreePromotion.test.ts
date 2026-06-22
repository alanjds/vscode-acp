import * as assert from 'assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';

import {
  applyWorktreeToHost,
  previewWorktreeChanges,
} from '../../sandcastle/WorktreePromotion';

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

function createWorktree(repo: string, branch: string): string {
  const worktree = path.join(repo, '.sandcastle-test', branch.replaceAll('/', '-'));
  fs.mkdirSync(path.dirname(worktree), { recursive: true });
  git(repo, ['worktree', 'add', '-b', branch, worktree, 'HEAD']);
  return worktree;
}

suite('WorktreePromotion', () => {
  let repo: string;
  let baseRef: string;
  const branch = 'sandcastle/test/promotion';

  setup(() => {
    repo = fs.mkdtempSync(path.join(os.tmpdir(), 'worktree-promotion-'));
    git(repo, ['init']);
    git(repo, ['config', 'user.email', 'tests@example.com']);
    git(repo, ['config', 'user.name', 'ACP Tests']);
    fs.writeFileSync(path.join(repo, 'README.md'), '# Test\n', 'utf8');
    git(repo, ['add', '.']);
    git(repo, ['commit', '-m', 'initial']);
    baseRef = git(repo, ['rev-parse', 'HEAD']);
  });

  teardown(() => {
    fs.rmSync(repo, { recursive: true, force: true });
  });

  test('previewWorktreeChanges reports modified files', async () => {
    const worktree = createWorktree(repo, branch);
    fs.writeFileSync(path.join(worktree, 'sentinel.txt'), 'changed', 'utf8');

    const preview = await previewWorktreeChanges(worktree, baseRef, branch);

    assert.ok(preview.diff.trim().length > 0);
    assert.strictEqual(preview.filesChanged, 1);
    assert.strictEqual(preview.branch, branch);
    assert.strictEqual(preview.baseRef, baseRef);
    assert.strictEqual(preview.worktreePath, worktree);
  });

  test('previewWorktreeChanges reports no changes on clean worktree', async () => {
    const worktree = createWorktree(repo, branch);

    const preview = await previewWorktreeChanges(worktree, baseRef, branch);

    assert.strictEqual(preview.diff.trim(), '');
    assert.strictEqual(preview.filesChanged, 0);
  });

  test('applyWorktreeToHost promotes changes to the host repository', async () => {
    const worktree = createWorktree(repo, branch);
    fs.writeFileSync(path.join(worktree, 'sentinel.txt'), 'promoted', 'utf8');
    const preview = await previewWorktreeChanges(worktree, baseRef, branch);

    const result = await applyWorktreeToHost(repo, preview);

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.filesChanged, 1);
    assert.strictEqual(fs.readFileSync(path.join(repo, 'sentinel.txt'), 'utf8'), 'promoted');
  });

  test('applyWorktreeToHost succeeds with empty diff', async () => {
    const worktree = createWorktree(repo, branch);
    const preview = await previewWorktreeChanges(worktree, baseRef, branch);

    const result = await applyWorktreeToHost(repo, preview);

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.filesChanged, 0);
    assert.strictEqual(result.message, 'No changes to apply.');
  });

  test('applyWorktreeToHost fails when patch cannot be applied', async () => {
    const worktree = createWorktree(repo, branch);
    const preview = await previewWorktreeChanges(worktree, baseRef, branch);
    preview.diff = 'not a valid patch';

    const result = await applyWorktreeToHost(repo, preview);

    assert.strictEqual(result.success, false);
    assert.strictEqual(fs.existsSync(path.join(repo, 'sentinel.txt')), false);
  });
});
