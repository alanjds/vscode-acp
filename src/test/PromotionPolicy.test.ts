import * as assert from 'assert';

import { decidePromotionPolicy } from '../sandcastle/PromotionPolicy';
import type { SandcastlePreview } from '../sandcastle/SandcastlePromotionUi';

const previewWithChanges: SandcastlePreview = {
  filesChanged: 2,
  diff: 'diff text',
  branch: 'sandcastle/test',
  baseRef: 'main',
  worktreePath: '/tmp/worktree',
};

const emptyPreview: SandcastlePreview = {
  filesChanged: 0,
  diff: '',
  branch: 'sandcastle/test',
  baseRef: 'main',
  worktreePath: '/tmp/worktree',
};

suite('PromotionPolicy', () => {
  test('discards when no files changed', () => {
    assert.strictEqual(decidePromotionPolicy(emptyPreview, 'ask'), 'discard_no_changes');
    assert.strictEqual(decidePromotionPolicy(emptyPreview, 'autoApply'), 'discard_no_changes');
  });

  test('auto applies when mode is autoApply', () => {
    assert.strictEqual(decidePromotionPolicy(previewWithChanges, 'autoApply'), 'auto_apply');
  });

  test('auto rejects when mode is autoReject', () => {
    assert.strictEqual(decidePromotionPolicy(previewWithChanges, 'autoReject'), 'auto_reject');
  });

  test('prompts when mode is ask and files changed', () => {
    assert.strictEqual(decidePromotionPolicy(previewWithChanges, 'ask'), 'prompt');
  });
});
