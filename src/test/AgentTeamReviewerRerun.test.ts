import * as assert from 'assert';

import { buildReviewerRerunPrompt } from '../pipeline/AgentTeamCompiler';

suite('AgentTeamCompiler reviewer re-run', () => {
  test('buildReviewerRerunPrompt includes instructions, snapshot, and diff', () => {
    const prompt = buildReviewerRerunPrompt({
      reviewerInstructions: '# Reviewer\nCheck quality.',
      approvedPlan: '<proposed_plan>plan</proposed_plan>',
      implementOutput: 'done',
      workspaceDiff: 'diff --git a/foo.ts',
    });

    assert.match(prompt, /# Reviewer/);
    assert.match(prompt, /approved plan/i);
    assert.match(prompt, /<proposed_plan>plan<\/proposed_plan>/);
    assert.match(prompt, /done/);
    assert.match(prompt, /diff --git a\/foo.ts/);
  });

  test('buildReviewerRerunPrompt substitutes empty diff placeholder', () => {
    const prompt = buildReviewerRerunPrompt({
      reviewerInstructions: 'Review',
      approvedPlan: 'plan',
      implementOutput: 'out',
      workspaceDiff: '',
    });

    assert.match(prompt, /\(no diff detected\)/);
  });
});
