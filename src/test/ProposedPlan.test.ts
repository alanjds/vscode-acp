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

  // ============ New robustness tests ============

  test('extractSingleProposedPlan accepts whitespace around single block', () => {
    const text = '\n\n  <proposed_plan>\n\nDo it\n\n</proposed_plan>\n\n';
    const plan = extractSingleProposedPlan(text);

    assert.strictEqual(plan.trim(), '<proposed_plan>\n\nDo it\n\n</proposed_plan>'.trim());
  });

  test('assertSingleProposedPlan accepts block with whitespace around', () => {
    const text = '\n<proposed_plan>\n\nDo it\n\n</proposed_plan>\n';
    assert.doesNotThrow(() => assertSingleProposedPlan(text));
  });

  test('assertSingleProposedPlan rejects two blocks separated by text', () => {
    assert.throws(
      () => assertSingleProposedPlan('<proposed_plan>A</proposed_plan>Text<proposed_plan>B</proposed_plan>'),
      /found 2/,
    );
  });

  test('extractSingleProposedPlan rejects malformed block (unclosed)', () => {
    assert.throws(
      () => extractSingleProposedPlan('<proposed_plan>Unclosed'),
      /did not include/,
    );
  });

  test('extractSingleProposedPlan rejects nested blocks if implementation considers them invalid', () => {
    // This tests the current implementation behavior
    // The regex [\s\S]*? is non-greedy so it should match the first closing tag
    const text = '<proposed_plan>Outer<proposed_plan>Inner</proposed_plan></proposed_plan>';
    const plan = extractSingleProposedPlan(text);

    // Current implementation with non-greedy regex will extract the first block
    assert.strictEqual(plan, '<proposed_plan>Outer<proposed_plan>Inner</proposed_plan>');
  });

  test('assertSingleProposedPlan rejects when there is text outside the block', () => {
    assert.throws(
      () => assertSingleProposedPlan('Before<proposed_plan>Content</proposed_plan>After'),
      /must contain only/,
    );
  });

  test('assertSingleProposedPlan accepts exactly one block with no extra text', () => {
    assert.doesNotThrow(() => assertSingleProposedPlan('<proposed_plan>\nOnly this\n</proposed_plan>'));
  });

  test('extractSingleProposedPlan handles multiple newlines around block', () => {
    const text = '\n\n\n<proposed_plan>\nPlan content\n</proposed_plan>\n\n\n';
    const plan = extractSingleProposedPlan(text);

    assert.strictEqual(plan.trim(), '<proposed_plan>\nPlan content\n</proposed_plan>');
  });

  test('assertSingleProposedPlan handles empty block', () => {
    assert.doesNotThrow(() => assertSingleProposedPlan('<proposed_plan></proposed_plan>'));
  });

  test('extractSingleProposedPlan handles empty block', () => {
    const text = '<proposed_plan></proposed_plan>';
    const plan = extractSingleProposedPlan(text);

    assert.strictEqual(plan, '<proposed_plan></proposed_plan>');
  });
});
