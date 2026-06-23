import * as assert from 'assert';

import type { PipelineDefinition } from '../config/PipelineCatalog';
import { PipelineService } from '../pipeline/PipelineService';

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
      prompt: 'Implement:\n{{steps.approval.output}}',
    },
    verifier: {
      agent: 'Codex',
      output: 'markdown',
      sideEffects: 'none',
      prompt: 'Verify:\n{{steps.implement.output}}',
    },
  },
  steps: [
    { id: 'plan', use: 'planner' },
    { id: 'approval', type: 'approval', input: '{{steps.plan.output}}' },
    { id: 'implement', use: 'implementer' },
    { id: 'verify', use: 'verifier' },
  ],
};

suite('PipelineService', () => {
  test('forwards engine events to service listeners', async () => {
    const statusEvents: string[] = [];
    const planReadyEvents: string[] = [];
    const sessionUpdateEvents: string[] = [];

    const service = createService({
      runAcpAgent: async (kind, _prompt, onSessionUpdate) => {
        onSessionUpdate?.({
          sessionId: 'plan-session',
          update: { sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: kind } },
        } as any);
        return '<proposed_plan>\nPlan\n</proposed_plan>';
      },
    });

    service.on('status', (event: any) => {
      statusEvents.push(event.status);
    });
    service.on('plan-ready', () => {
      planReadyEvents.push('plan-ready');
    });
    service.on('session-update', () => {
      sessionUpdateEvents.push('session-update');
    });

    try {
      await service.createPlan('session-1', 'build feature', PLAN_EXECUTE_VERIFY_PIPELINE.title);

      assert.ok(statusEvents.includes('planning'));
      assert.ok(statusEvents.includes('awaiting_approval'));
      assert.strictEqual(planReadyEvents.length, 1);
      assert.ok(sessionUpdateEvents.length > 0);
    } finally {
      await service.dispose();
    }
  });

  test('dispose clears service listeners after engine shutdown', async () => {
    const service = createService({
      runAcpAgent: async () => '<proposed_plan>\nPlan\n</proposed_plan>',
    });
    service.on('status', () => {});

    await service.createPlan('session-1', 'build feature', PLAN_EXECUTE_VERIFY_PIPELINE.title);
    await service.dispose();

    assert.strictEqual(service.listenerCount('status'), 0);
  });
});

function createService(options: {
  runAcpAgent: NonNullable<ConstructorParameters<typeof PipelineService>[1]>['runAcpAgent'];
}): PipelineService {
  return new PipelineService(
    () => '/repo',
    {
      getPipelineDefinitions: () => [PLAN_EXECUTE_VERIFY_PIPELINE],
      getPipelineDefinitionForAgent: (agentName) =>
        agentName === PLAN_EXECUTE_VERIFY_PIPELINE.title ? PLAN_EXECUTE_VERIFY_PIPELINE : null,
      getAgentConfigs: () => ({ Codex: {}, Vibe: {} }),
      runAcpAgent: options.runAcpAgent,
    },
  );
}
