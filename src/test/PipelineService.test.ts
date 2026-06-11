import * as assert from 'assert';

import { PipelineService } from '../pipeline/PipelineService';
import type { PipelineConfig } from '../config/PipelineConfig';

const PIPELINE_CONFIG: PipelineConfig = {
  enabled: true,
  virtualAgentName: 'Pipeline',
  plannerAgentName: 'Codex',
  implementerAgentName: 'Vibe',
};

suite('PipelineService', () => {
  test('plans first and does not call implementer before approval', async () => {
    const calls: Array<{ kind: string; prompt: string }> = [];
    const service = new PipelineService(
      () => '/repo',
      {
        getPipelineConfig: () => PIPELINE_CONFIG,
        getAgentConfigs: () => ({ Codex: {}, Vibe: {} }),
        runAcpAgent: async (kind, prompt) => {
          calls.push({ kind, prompt });
          return '<proposed_plan>\nImplement it\n</proposed_plan>';
        },
      },
    );

    try {
      const plan = await service.createPlan('session-1', 'build feature');

      assert.strictEqual(plan, '<proposed_plan>\nImplement it\n</proposed_plan>');
      assert.deepStrictEqual(calls.map(call => call.kind), ['planner']);
    } finally {
      await service.dispose();
    }
  });

  test('sends edited approved plan to implementer', async () => {
    const calls: Array<{ kind: string; prompt: string }> = [];
    const service = new PipelineService(
      () => '/repo',
      {
        getPipelineConfig: () => PIPELINE_CONFIG,
        getAgentConfigs: () => ({ Codex: {}, Vibe: {} }),
        runAcpAgent: async (kind, prompt) => {
          calls.push({ kind, prompt });
          if (kind === 'planner') {
            return '<proposed_plan>\nInitial\n</proposed_plan>';
          }
          return 'implemented';
        },
      },
    );

    try {
      await service.createPlan('session-1', 'build feature');
      await service.approvePlan('session-1', '<proposed_plan>\nEdited\n</proposed_plan>');

      assert.deepStrictEqual(calls.map(call => call.kind), ['planner', 'implementer']);
      assert.ok(calls[1].prompt.includes('Original user request:\nbuild feature'));
      assert.ok(calls[1].prompt.includes('<proposed_plan>\nEdited\n</proposed_plan>'));
    } finally {
      await service.dispose();
    }
  });

  test('fails early when configured ACP agents are missing', async () => {
    const service = new PipelineService(
      () => '/repo',
      {
        getPipelineConfig: () => PIPELINE_CONFIG,
        getAgentConfigs: () => ({ Codex: {} }),
        runAcpAgent: async () => '<proposed_plan>\nNever called\n</proposed_plan>',
      },
    );

    try {
      await assert.rejects(
        () => service.createPlan('session-1', 'build feature'),
        /Vibe/,
      );
    } finally {
      await service.dispose();
    }
  });
});

