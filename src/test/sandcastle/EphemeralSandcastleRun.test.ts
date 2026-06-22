import * as assert from 'assert';

import type { EphemeralRunResult } from '../../core/EphemeralRun';
import { finishEphemeralSandcastleRun } from '../../sandcastle/EphemeralSandcastleRun';
import { SandcastlePromotion } from '../../sandcastle/SandcastlePromotion';

suite('EphemeralSandcastleRun', () => {
  test('finishEphemeralSandcastleRun returns text only when run has no sandbox', async () => {
    const run: EphemeralRunResult = { text: 'hello' };
    const promotion = new SandcastlePromotion({} as any);

    const result = await finishEphemeralSandcastleRun(promotion, run);

    assert.deepStrictEqual(result, { text: 'hello' });
  });

  test('finishEphemeralSandcastleRun delegates to SandcastlePromotion.finishEphemeralRun', async () => {
    const calls: string[] = [];
    const promotion = new SandcastlePromotion({} as any, {
      discard: async () => {
        calls.push('discard');
      },
    } as any);
    const run: EphemeralRunResult = {
      text: 'done',
      sandbox: {
        connection: { extMethod: async () => ({}) },
        sessionId: 'sandbox-1',
      },
    };

    const result = await finishEphemeralSandcastleRun(promotion, run, { sideEffects: 'none' });

    assert.deepStrictEqual(result, { text: 'done', promotion: undefined });
    assert.deepStrictEqual(calls, ['discard']);
  });
});
