import * as assert from 'assert';

import { assertSingleProposedPlan, extractSingleProposedPlan } from '../pipeline/ProposedPlan';

suite('ProposedPlan', () => {
  test('extracts exactly one proposed plan block', () => {
    const plan = extractSingleProposedPlan('before\n<proposed_plan>\nDo it\n</proposed_plan>\nafter');

    assert.strictEqual(plan, '<proposed_plan>\nDo it\n</proposed_plan>');
  });

  test('rejects missing proposed plan block', () => {
    assert.throws(
      () => extractSingleProposedPlan('no plan here'),
      /did not include/,
    );
  });

  test('rejects multiple proposed plan blocks', () => {
    assert.throws(
      () => extractSingleProposedPlan('<proposed_plan>A</proposed_plan><proposed_plan>B</proposed_plan>'),
      /expected exactly one/,
    );
  });

  test('approved plan must contain only the proposed plan block', () => {
    assert.doesNotThrow(() => assertSingleProposedPlan('<proposed_plan>\nDo it\n</proposed_plan>'));
    assert.throws(
      () => assertSingleProposedPlan('intro\n<proposed_plan>\nDo it\n</proposed_plan>'),
      /must contain only/,
    );
  });
});

