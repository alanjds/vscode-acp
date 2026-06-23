import * as assert from 'assert';

import type { PipelinePrimitiveDefinition } from '../config/PipelineCatalog';
import type { EphemeralAgentRunner } from '../core/EphemeralAgentRunner';
import { PipelineExecutor } from '../pipeline/PipelineExecutor';
import { PipelineStepRejectedError } from '../pipeline/PipelineStepCompletion';

const primitive: PipelinePrimitiveDefinition = {
  agent: 'Vibe',
  prompt: 'do work',
  output: 'markdown',
  sideEffects: 'none',
};

suite('PipelineExecutor', () => {
  test('runStep delegates to runAcpAgent override when provided', async () => {
    const executor = new PipelineExecutor({
      workspaceCwd: () => '/repo',
      ephemeralRunner: { run: async () => ({ text: 'unused' }) },
      runAcpAgent: async () => 'from-test-adapter',
    });

    const text = await executor.runStep('planner', primitive, 'prompt', {
      signal: new AbortController().signal,
    });
    assert.strictEqual(text, 'from-test-adapter');
  });

  test('runStep uses ephemeral runner when no override', async () => {
    let capturedAgent = '';
    const runner: EphemeralAgentRunner = {
      run: async input => {
        capturedAgent = input.agentName;
        return { text: 'runner-output' };
      },
    };

    const executor = new PipelineExecutor({
      workspaceCwd: () => '/repo',
      ephemeralRunner: runner,
    });

    const text = await executor.runStep('planner', primitive, 'hello', {
      signal: new AbortController().signal,
    });
    assert.strictEqual(text, 'runner-output');
    assert.strictEqual(capturedAgent, 'Vibe');
  });

  test('runStep propagates Sandcastle rejection from runner result', async () => {
    const runner: EphemeralAgentRunner = {
      run: async () => ({ text: 'x', promotion: 'rejected' }),
    };

    const executor = new PipelineExecutor({
      workspaceCwd: () => '/repo',
      ephemeralRunner: runner,
    });

    await assert.rejects(
      () => executor.runStep('implementer', { ...primitive, sideEffects: 'workspace' }, 'go', {
        signal: new AbortController().signal,
        approvedPlan: 'plan',
      }),
      (error: unknown) => error instanceof PipelineStepRejectedError,
    );
  });

  test('runStep requires approved plan for workspace side effects', async () => {
    const executor = new PipelineExecutor({
      workspaceCwd: () => '/repo',
      ephemeralRunner: { run: async () => ({ text: 'x' }) },
    });

    await assert.rejects(
      () => executor.runStep('implementer', { ...primitive, sideEffects: 'workspace' }, 'go', {
        signal: new AbortController().signal,
      }),
      /approved plan/i,
    );
  });
});
