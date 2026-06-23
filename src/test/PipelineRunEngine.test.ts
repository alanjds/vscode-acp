import * as assert from 'assert';

import type { PipelineDefinition } from '../config/PipelineCatalog';
import { RunAbortedError } from '../core/RunAbortedError';
import { PipelineRunEngine } from '../pipeline/PipelineRunEngine';

const PLAN_EXECUTE_VERIFY_PIPELINE: PipelineDefinition = {
  version: 2,
  id: 'plan-execute-verify',
  title: 'Plan Execute Verify',
  primitives: {
    planner: {
      agent: 'Codex',
      output: 'proposed_plan',
      sideEffects: 'none',
      prompt: 'Plan:\n{{userPrompt}}',
    },
    implementer: {
      agent: 'Vibe',
      output: 'markdown',
      sideEffects: 'workspace',
      prompt: [
        'Implement:',
        '{{steps.approval.output}}',
        '',
        'Original:',
        '{{userPrompt}}',
      ].join('\n'),
    },
    verifier: {
      agent: 'Codex',
      output: 'markdown',
      sideEffects: 'none',
      prompt: [
        'Verify:',
        '{{steps.approval.output}}',
        '',
        'Implementation:',
        '{{steps.implement.output}}',
      ].join('\n'),
    },
  },
  steps: [
    { id: 'plan', use: 'planner' },
    { id: 'approval', type: 'approval', input: '{{steps.plan.output}}' },
    { id: 'implement', use: 'implementer' },
    { id: 'verify', use: 'verifier' },
  ],
};

const PARALLEL_PIPELINE: PipelineDefinition = {
  version: 2,
  id: 'parallel-plan',
  title: 'Parallel Plan',
  primitives: {
    planner: {
      agent: 'Codex',
      output: 'proposed_plan',
      sideEffects: 'none',
      prompt: 'Plan:\n{{userPrompt}}',
    },
    repo: {
      agent: 'Codex',
      output: 'markdown',
      sideEffects: 'none',
      prompt: 'Repo:\n{{steps.plan.output}}',
    },
    tests: {
      agent: 'Codex',
      output: 'markdown',
      sideEffects: 'none',
      prompt: 'Tests:\n{{steps.plan.output}}',
    },
    synthesize: {
      agent: 'Codex',
      output: 'proposed_plan',
      sideEffects: 'none',
      prompt: [
        'Synthesize:',
        '{{steps.investigate.branches.repo.output}}',
        '{{steps.investigate.branches.tests.output}}',
      ].join('\n'),
    },
  },
  steps: [
    { id: 'plan', use: 'planner' },
    {
      id: 'investigate',
      type: 'parallel',
      branches: [
        { id: 'repo', use: 'repo' },
        { id: 'tests', use: 'tests' },
      ],
    },
    { id: 'synthesize', use: 'synthesize' },
    { id: 'approval', type: 'approval', input: '{{steps.synthesize.output}}' },
  ],
};

suite('PipelineRunEngine', () => {
  test('plans first and does not call implementer before approval', async () => {
    const calls: Array<{ kind: string; prompt: string }> = [];
    const events: string[] = [];
    const engine = createEngine({
      runAcpAgent: async (kind, prompt) => {
        calls.push({ kind, prompt });
        return '<proposed_plan>\nImplement it\n</proposed_plan>';
      },
    });

    engine.on('status', (event: any) => {
      events.push(event.status);
    });
    engine.on('plan-ready', () => {
      events.push('plan-ready');
    });

    try {
      const plan = await engine.createPlan('session-1', 'build feature', PLAN_EXECUTE_VERIFY_PIPELINE.title);

      assert.strictEqual(plan, '<proposed_plan>\nImplement it\n</proposed_plan>');
      assert.deepStrictEqual(calls.map(call => call.kind), ['plan']);
      assert.deepStrictEqual(events, ['planning', 'plan-ready', 'awaiting_approval']);
    } finally {
      await engine.dispose();
    }
  });

  test('approvePlan resumes graph, sends edited plan to implementer, then verifies', async () => {
    const calls: Array<{ kind: string; prompt: string }> = [];
    const engine = createEngine({
      runAcpAgent: async (kind, prompt) => {
        calls.push({ kind, prompt });
        if (kind === 'plan') {
          return '<proposed_plan>\nInitial\n</proposed_plan>';
        }
        if (kind === 'implement') {
          return 'implemented successfully';
        }
        return 'verified successfully';
      },
    });

    try {
      await engine.createPlan('session-1', 'build feature', PLAN_EXECUTE_VERIFY_PIPELINE.title);
      const finalOutput = await engine.approvePlan('session-1', '<proposed_plan>\nEdited\n</proposed_plan>');

      assert.strictEqual(finalOutput, 'verified successfully');
      assert.deepStrictEqual(calls.map(call => call.kind), ['plan', 'implement', 'verify']);
      assert.ok(calls[1].prompt.includes('<proposed_plan>\nEdited\n</proposed_plan>'));
      assert.ok(calls[2].prompt.includes('implemented successfully'));
    } finally {
      await engine.dispose();
    }
  });

  test('rejectPlan emits rejected and does not call implementer', async () => {
    const calls: string[] = [];
    const events: string[] = [];
    const engine = createEngine({
      runAcpAgent: async (kind) => {
        calls.push(kind);
        return '<proposed_plan>\nPlan\n</proposed_plan>';
      },
    });
    engine.on('status', (event: any) => {
      events.push(event.status);
    });

    try {
      await engine.createPlan('session-1', 'build feature', PLAN_EXECUTE_VERIFY_PIPELINE.title);
      engine.rejectPlan('session-1');

      assert.deepStrictEqual(calls, ['plan']);
      assert.ok(events.includes('rejected'));
      await assert.rejects(
        () => engine.approvePlan('session-1', '<proposed_plan>\nPlan\n</proposed_plan>'),
        /No pending pipeline plan/,
      );
    } finally {
      await engine.dispose();
    }
  });

  test('createPlan rejects when planner returns zero proposed_plan blocks', async () => {
    const engine = createEngine({
      runAcpAgent: async () => 'No plan here',
    });

    try {
      await assert.rejects(
        () => engine.createPlan('session-1', 'build feature', PLAN_EXECUTE_VERIFY_PIPELINE.title),
        /did not include/,
      );
    } finally {
      await engine.dispose();
    }
  });

  test('createPlan rejects when planner returns multiple proposed_plan blocks', async () => {
    const engine = createEngine({
      runAcpAgent: async () => '<proposed_plan>\nA\n</proposed_plan><proposed_plan>\nB\n</proposed_plan>',
    });

    try {
      await assert.rejects(
        () => engine.createPlan('session-1', 'build feature', PLAN_EXECUTE_VERIFY_PIPELINE.title),
        /expected exactly one/,
      );
    } finally {
      await engine.dispose();
    }
  });

  test('approvePlan rejects when plan contains text outside proposed_plan block', async () => {
    const engine = createEngine({
      runAcpAgent: async () => '<proposed_plan>\nPlan\n</proposed_plan>',
    });

    try {
      await engine.createPlan('session-1', 'build feature', PLAN_EXECUTE_VERIFY_PIPELINE.title);

      await assert.rejects(
        () => engine.approvePlan('session-1', 'Intro text\n<proposed_plan>\nPlan\n</proposed_plan>'),
        /must contain only/,
      );
    } finally {
      await engine.dispose();
    }
  });

  test('approvePlan emits error and cleans state when implementer fails', async () => {
    const events: string[] = [];
    const engine = createEngine({
      runAcpAgent: async (kind) => {
        if (kind === 'plan') {
          return '<proposed_plan>\nPlan\n</proposed_plan>';
        }
        throw new Error('Implementer failed');
      },
    });
    engine.on('status', (event: any) => {
      events.push(event.status);
    });

    try {
      await engine.createPlan('session-1', 'build feature', PLAN_EXECUTE_VERIFY_PIPELINE.title);

      await assert.rejects(
        () => engine.approvePlan('session-1', '<proposed_plan>\nPlan\n</proposed_plan>'),
        /Implementer failed/,
      );

      assert.ok(events.includes('error'));
      await assert.rejects(
        () => engine.approvePlan('session-1', '<proposed_plan>\nNew plan\n</proposed_plan>'),
        /No pending pipeline plan/,
      );
    } finally {
      await engine.dispose();
    }
  });

  test('runs parallel read-only branches and exposes branch outputs to synthesize', async () => {
    const calls: Array<{ kind: string; prompt: string }> = [];
    const engine = createEngine({
      pipelines: [PARALLEL_PIPELINE],
      runAcpAgent: async (kind, prompt) => {
        calls.push({ kind, prompt });
        if (kind === 'plan') {
          return '<proposed_plan>\nPlan\n</proposed_plan>';
        }
        if (kind === 'investigate__repo') {
          return 'Repo findings';
        }
        if (kind === 'investigate__tests') {
          return 'Test findings';
        }
        return '<proposed_plan>\nSynthesized\n</proposed_plan>';
      },
    });

    try {
      const plan = await engine.createPlan('session-1', 'build feature', PARALLEL_PIPELINE.title);

      assert.strictEqual(plan, '<proposed_plan>\nSynthesized\n</proposed_plan>');
      assert.deepStrictEqual(
        calls.map(call => call.kind).sort(),
        ['investigate__repo', 'investigate__tests', 'plan', 'synthesize'].sort(),
      );
      const synthesizeCall = calls.find(call => call.kind === 'synthesize');
      assert.ok(synthesizeCall?.prompt.includes('Repo findings'));
      assert.ok(synthesizeCall?.prompt.includes('Test findings'));
    } finally {
      await engine.dispose();
    }
  });

  test('forwards ACP session updates with step and branch metadata', async () => {
    const events: Array<{ phase: string; stepId?: string; branchId?: string; updateType: string }> = [];
    const engine = createEngine({
      pipelines: [PARALLEL_PIPELINE],
      runAcpAgent: async (kind, _prompt, onSessionUpdate) => {
        onSessionUpdate?.({
          sessionId: `${kind}-session`,
          update: { sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: kind } },
        } as any);
        if (kind === 'plan' || kind === 'synthesize') {
          return '<proposed_plan>\nPlan\n</proposed_plan>';
        }
        return `${kind} output`;
      },
    });
    engine.on('session-update', (event: any) => {
      events.push({
        phase: event.phase,
        stepId: event.stepId,
        branchId: event.branchId,
        updateType: event.update.update.sessionUpdate,
      });
    });

    try {
      await engine.createPlan('session-1', 'build feature', PARALLEL_PIPELINE.title);

      assert.ok(events.some(event => event.phase === 'plan' && event.stepId === 'plan'));
      assert.ok(events.some(event =>
        event.phase === 'investigate/repo'
        && event.stepId === 'investigate'
        && event.branchId === 'repo'));
    } finally {
      await engine.dispose();
    }
  });

  test('createPlan revises pending plan when user sends follow-up message', async () => {
    const calls: Array<{ kind: string; prompt: string }> = [];
    const planReadyEvents: Array<{ plan: string; revised?: boolean }> = [];
    let plannerCall = 0;
    const engine = createEngine({
      runAcpAgent: async (kind, prompt) => {
        calls.push({ kind, prompt });
        if (kind === 'plan') {
          plannerCall += 1;
          return plannerCall === 1
            ? '<proposed_plan>\nInitial\n</proposed_plan>'
            : '<proposed_plan>\nRevised\n</proposed_plan>';
        }
        return 'implemented successfully';
      },
    });
    engine.on('plan-ready', (event: any) => {
      planReadyEvents.push({ plan: event.plan, revised: event.revised });
    });

    try {
      await engine.createPlan('session-1', 'build feature', PLAN_EXECUTE_VERIFY_PIPELINE.title);
      const revised = await engine.createPlan('session-1', 'add more tests', PLAN_EXECUTE_VERIFY_PIPELINE.title);

      assert.strictEqual(revised, '<proposed_plan>\nRevised\n</proposed_plan>');
      assert.strictEqual(calls.filter(call => call.kind === 'plan').length, 2);
      assert.ok(calls[1].prompt.includes('add more tests'));
      assert.ok(calls[1].prompt.includes('Initial'));
      assert.ok(calls[1].prompt.includes('build feature'));
      assert.strictEqual(calls.filter(call => call.kind === 'implement').length, 0);
      assert.deepStrictEqual(planReadyEvents, [
        { plan: '<proposed_plan>\nInitial\n</proposed_plan>', revised: false },
        { plan: '<proposed_plan>\nRevised\n</proposed_plan>', revised: true },
      ]);
    } finally {
      await engine.dispose();
    }
  });

  test('approvePlan after revision sends revised plan to implementer', async () => {
    const calls: Array<{ kind: string; prompt: string }> = [];
    let plannerCall = 0;
    const engine = createEngine({
      runAcpAgent: async (kind, prompt) => {
        calls.push({ kind, prompt });
        if (kind === 'plan') {
          plannerCall += 1;
          return plannerCall === 1
            ? '<proposed_plan>\nInitial\n</proposed_plan>'
            : '<proposed_plan>\nRevised\n</proposed_plan>';
        }
        if (kind === 'implement') {
          return 'implemented successfully';
        }
        return 'verified successfully';
      },
    });

    try {
      await engine.createPlan('session-1', 'build feature', PLAN_EXECUTE_VERIFY_PIPELINE.title);
      await engine.createPlan('session-1', 'add tests', PLAN_EXECUTE_VERIFY_PIPELINE.title);
      const finalOutput = await engine.approvePlan('session-1', '<proposed_plan>\nRevised\n</proposed_plan>');

      assert.strictEqual(finalOutput, 'verified successfully');
      assert.ok(calls.some(call => call.kind === 'implement' && call.prompt.includes('Revised')));
      assert.strictEqual(calls.filter(call => call.kind === 'implement').length, 1);
    } finally {
      await engine.dispose();
    }
  });

  test('failed revision preserves pending plan for approval', async () => {
    let plannerCall = 0;
    const engine = createEngine({
      runAcpAgent: async (kind) => {
        if (kind === 'plan') {
          plannerCall += 1;
          if (plannerCall === 1) {
            return '<proposed_plan>\nInitial\n</proposed_plan>';
          }
          throw new Error('planner failed');
        }
        if (kind === 'implement') {
          return 'implemented successfully';
        }
        return 'verified successfully';
      },
    });

    try {
      await engine.createPlan('session-1', 'build feature', PLAN_EXECUTE_VERIFY_PIPELINE.title);
      await assert.rejects(
        () => engine.createPlan('session-1', 'bad revision', PLAN_EXECUTE_VERIFY_PIPELINE.title),
        /planner failed/,
      );
      const finalOutput = await engine.approvePlan('session-1', '<proposed_plan>\nInitial\n</proposed_plan>');
      assert.strictEqual(finalOutput, 'verified successfully');
    } finally {
      await engine.dispose();
    }
  });

  test('dispose cancels pending runs and clears listeners', async () => {
    const events: Array<{ sessionId: string; status: string }> = [];
    const engine = createEngine({
      runAcpAgent: async () => '<proposed_plan>\nPlan\n</proposed_plan>',
    });
    engine.on('status', (event: any) => {
      events.push({ sessionId: event.sessionId, status: event.status });
    });

    await engine.createPlan('session-1', 'build feature', PLAN_EXECUTE_VERIFY_PIPELINE.title);
    await engine.createPlan('session-2', 'build feature', PLAN_EXECUTE_VERIFY_PIPELINE.title);
    await engine.dispose();

    assert.strictEqual(events.filter(e => e.status === 'cancelled').length, 2);
    assert.strictEqual(engine.listenerCount('status'), 0);
  });

  test('cancel aborts in-flight runAcpAgent via AbortSignal', async () => {
    const events: Array<{ status: string }> = [];
    let receivedSignal: AbortSignal | undefined;

    const engine = createEngine({
      runAcpAgent: async (_kind, _prompt, _onSessionUpdate, signal) => {
        receivedSignal = signal;
        return new Promise<string>((_resolve, reject) => {
          signal?.addEventListener('abort', () => {
            reject(new RunAbortedError());
          }, { once: true });
        });
      },
    });

    engine.on('status', (event: any) => {
      events.push({ status: event.status });
    });

    const planPromise = engine.createPlan('session-1', 'build feature', PLAN_EXECUTE_VERIFY_PIPELINE.title);
    await new Promise(resolve => setTimeout(resolve, 20));

    engine.cancel('session-1');

    await assert.rejects(() => planPromise);
    assert.strictEqual(receivedSignal?.aborted, true);
    assert.ok(events.some(event => event.status === 'cancelled'));
  });
});

function createEngine(options: {
  pipelines?: PipelineDefinition[];
  runAcpAgent: NonNullable<ConstructorParameters<typeof PipelineRunEngine>[1]>['runAcpAgent'];
}): PipelineRunEngine {
  const pipelines = options.pipelines ?? [PLAN_EXECUTE_VERIFY_PIPELINE];
  return new PipelineRunEngine(
    () => '/repo',
    {
      getPipelineDefinitions: () => pipelines,
      getPipelineDefinitionForAgent: (agentName) =>
        pipelines.find(pipeline => pipeline.title === agentName) ?? null,
      getAgentConfigs: () => ({ Codex: {}, Vibe: {} }),
      runAcpAgent: options.runAcpAgent,
    },
  );
}
