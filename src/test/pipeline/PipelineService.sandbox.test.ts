import * as assert from 'assert';

import { PipelineService } from '../../pipeline/PipelineService';
import type { PipelineDefinition } from '../../config/PipelineCatalog';
import type { SandboxContext } from '../../sandbox/SandboxContext';

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

suite('PipelineService sandbox integration', () => {
  test('workspace sideEffects step creates sandbox when enabled', async () => {
    const calls: Array<{ kind: string; sandboxRoot?: string }> = [];
    const createdSandboxes: SandboxContext[] = [];
    const promotedSandboxes: SandboxContext[] = [];

    const sandboxContext: SandboxContext = {
      id: 'sandbox-1',
      root: '/repo/.acp/sandboxes/sandbox-1',
      baseCwd: '/repo',
      baseRef: 'abc123',
      branch: 'sandbox/sandbox-1',
      createdAt: new Date().toISOString(),
    };

    const service = new PipelineService(
      () => '/repo',
      {
        getPipelineDefinitions: () => [PLAN_EXECUTE_VERIFY_PIPELINE],
        getPipelineDefinitionForAgent: (agentName) =>
          PLAN_EXECUTE_VERIFY_PIPELINE.title === agentName ? PLAN_EXECUTE_VERIFY_PIPELINE : null,
        getAgentConfigs: () => ({ Codex: {}, Vibe: {} }),
        isSandboxEnabled: () => true,
        sandboxService: {
          create: async () => {
            createdSandboxes.push(sandboxContext);
            return sandboxContext;
          },
          destroy: async () => undefined,
          getRegistry: () => ({ getActive: () => sandboxContext }) as any,
        } as any,
        sandboxPromotionPanel: {
          show: async (ctx: SandboxContext) => {
            promotedSandboxes.push(ctx);
            return 'applied';
          },
        } as any,
        runAcpAgent: async (kind, _prompt, _onSessionUpdate, _signal, sandbox) => {
          calls.push({
            kind,
            sandboxRoot: sandbox?.root,
          });
          if (kind === 'plan') {
            return '<proposed_plan>\nImplement it\n</proposed_plan>';
          }
          return 'done';
        },
      },
    );

    try {
      await service.createPlan('session-1', 'build feature', PLAN_EXECUTE_VERIFY_PIPELINE.title);
      await service.approvePlan('session-1', '<proposed_plan>\nImplement it\n</proposed_plan>');

      assert.strictEqual(calls.some(call => call.kind === 'plan'), true);
      assert.strictEqual(calls.some(call => call.kind === 'implement'), true);
      assert.strictEqual(createdSandboxes.length, 1);
      assert.strictEqual(promotedSandboxes.length, 1);
      assert.strictEqual(promotedSandboxes[0]?.id, 'sandbox-1');
    } finally {
      await service.dispose();
    }
  });

  test('workspace sideEffects step skips sandbox when disabled', async () => {
    const createdSandboxes: SandboxContext[] = [];

    const service = new PipelineService(
      () => '/repo',
      {
        getPipelineDefinitions: () => [PLAN_EXECUTE_VERIFY_PIPELINE],
        getPipelineDefinitionForAgent: (agentName) =>
          PLAN_EXECUTE_VERIFY_PIPELINE.title === agentName ? PLAN_EXECUTE_VERIFY_PIPELINE : null,
        getAgentConfigs: () => ({ Codex: {}, Vibe: {} }),
        isSandboxEnabled: () => false,
        sandboxService: {
          create: async (baseCwd: string) => {
            createdSandboxes.push({
              id: 'unused',
              root: `${baseCwd}/unused`,
              baseCwd,
              baseRef: 'abc',
              branch: 'sandbox/unused',
              createdAt: new Date().toISOString(),
            });
            throw new Error('should not create sandbox');
          },
        } as any,
        runAcpAgent: async (kind) => {
          if (kind === 'plan') {
            return '<proposed_plan>\nImplement it\n</proposed_plan>';
          }
          return 'done';
        },
      },
    );

    try {
      await service.createPlan('session-1', 'build feature', PLAN_EXECUTE_VERIFY_PIPELINE.title);
      await service.approvePlan('session-1', '<proposed_plan>\nImplement it\n</proposed_plan>');
      assert.strictEqual(createdSandboxes.length, 0);
    } finally {
      await service.dispose();
    }
  });
});
