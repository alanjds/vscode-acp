import * as assert from 'assert';

import {
  PipelineStepCancelledError,
  PipelineStepRejectedError,
  isPipelineStepCancelled,
  isPipelineStepRejected,
  resolvePipelineStepText,
} from '../pipeline/PipelineStepCompletion';

suite('PipelineStepCompletion', () => {
  test('resolvePipelineStepText returns string results unchanged', () => {
    assert.strictEqual(resolvePipelineStepText('done'), 'done');
  });

  test('resolvePipelineStepText returns text when promotion applied', () => {
    assert.strictEqual(
      resolvePipelineStepText({ text: 'implemented', promotion: 'applied' }),
      'implemented',
    );
  });

  test('resolvePipelineStepText throws PipelineStepRejectedError when rejected', () => {
    assert.throws(
      () => resolvePipelineStepText({ text: 'x', promotion: 'rejected' }),
      (error: unknown) => error instanceof PipelineStepRejectedError,
    );
  });

  test('resolvePipelineStepText throws PipelineStepCancelledError when cancelled', () => {
    assert.throws(
      () => resolvePipelineStepText({ text: 'x', promotion: 'cancelled' }),
      (error: unknown) => isPipelineStepCancelled(error),
    );
  });

  test('error type guards match thrown errors', () => {
    assert.ok(isPipelineStepRejected(new PipelineStepRejectedError()));
    assert.ok(isPipelineStepCancelled(new PipelineStepCancelledError()));
    assert.strictEqual(isPipelineStepRejected(new PipelineStepCancelledError()), false);
  });
});
