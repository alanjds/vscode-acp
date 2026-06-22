import * as assert from 'assert';

import { buildPromptWithHistory } from '../../sandcastle/PromptHistory';

suite('PromptHistory', () => {
  test('returns a first prompt unchanged', () => {
    assert.strictEqual(buildPromptWithHistory([], 'first'), 'first');
  });

  test('keeps only the latest eight turns', () => {
    const history = Array.from({ length: 20 }, (_, index) => ({
      role: index % 2 === 0 ? 'user' as const : 'assistant' as const,
      text: `message-${index}`,
    }));
    const prompt = buildPromptWithHistory(history, 'current');
    assert.ok(!prompt.includes('message-3'));
    assert.ok(prompt.includes('message-4'));
    assert.ok(prompt.includes('message-19'));
    assert.ok(prompt.endsWith('current'));
  });

  test('bounds history to 64 KiB', () => {
    const prompt = buildPromptWithHistory([
      { role: 'user', text: 'x'.repeat(70 * 1024) },
    ], 'current');
    assert.strictEqual(prompt, 'current');
  });
});
