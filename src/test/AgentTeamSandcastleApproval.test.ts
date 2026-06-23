import * as assert from 'assert';

import type { PipelineDefinition } from '../config/PipelineCatalog';
import type { CompiledTeamMetadata } from '../pipeline/AgentTeamCompiler';
import { PipelineService } from '../pipeline/PipelineService';
import { PipelineRunEngine } from '../pipeline/PipelineRunEngine';

const FEATURE_TEAM_PIPELINE: PipelineDefinition = {
  version: 2,
  id: 'team-feature-team',
  title: 'Feature Team',
  primitives: {
    planner: {
      agent: 'Cursor CLI',
      output: 'proposed_plan',
      sideEffects: 'none',
      prompt: 'Plan:\n{{userPrompt}}',
    },
    implementer: {
      agent: 'Cursor Sandcastle',
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
    reviewer: {
      agent: 'Cursor CLI',
      output: 'markdown',
      sideEffects: 'none',
      prompt: [
        'Review:',
        '{{steps.approval.output}}',
        '',
        'Implementation:',
        '{{steps.implementer.output}}',
      ].join('\n'),
    },
    tester: {
      agent: 'Cursor CLI',
      output: 'markdown',
      sideEffects: 'none',
      prompt: 'Test: {{steps.implementer.output}}',
    },
  },
  steps: [
    { id: 'planner', use: 'planner' },
    { id: 'approval', type: 'approval', input: '{{steps.planner.output}}' },
    { id: 'implementer', use: 'implementer' },
    { id: 'reviewer', use: 'reviewer' },
    { id: 'tester', use: 'tester' },
  ],
  metadata: {
    sourceKind: 'team',
    sourceFilePath: '.acp/teams/feature-team.yaml',
    teamId: 'feature-team',
    roleByStepId: {
      planner: 'planner',
      approval: 'planner',
      implementer: 'implementer',
      reviewer: 'reviewer',
    },
    agentByRole: {
      planner: 'Cursor CLI',
      implementer: 'Cursor Sandcastle',
      reviewer: 'Cursor CLI',
      tester: 'Vibe',
    },
    instructionsByRole: {
      planner: 'Plan the work.',
      implementer: 'Implement the plan.',
      reviewer: 'Review the implementation.',
      tester: 'Test the feature.',
    },
  } satisfies CompiledTeamMetadata,
};

suite('AgentTeamSandcastleApproval', () => {
  test('team with Sandcastle implementer pauses at awaiting_approval without running implementer', async () => {
    const calls: string[] = [];
    const planReadyEvents: Array<{ implementerUsesSandcastle?: boolean }> = [];
    const statusEvents: Array<{ status: string; message: string; implementerUsesSandcastle?: boolean }> = [];
    const service = createService({
      runAcpAgent: async (kind) => {
        calls.push(kind);
        return '<proposed_plan>\nSandcastle plan\n</proposed_plan>';
      },
    });

    service.on('plan-ready', (event) => {
      planReadyEvents.push({ implementerUsesSandcastle: event.implementerUsesSandcastle });
    });
    service.on('status', (event) => {
      statusEvents.push({
        status: event.status,
        message: event.message,
        implementerUsesSandcastle: event.implementerUsesSandcastle,
      });
    });

    try {
      await service.createPlan('session-1', 'build feature', FEATURE_TEAM_PIPELINE.title);

      assert.deepStrictEqual(calls, ['planner']);
      assert.ok(statusEvents.some(event =>
        event.status === 'awaiting_approval'
        && event.implementerUsesSandcastle === true
        && event.message.includes('Sandcastle'),
      ));
      assert.strictEqual(planReadyEvents[0]?.implementerUsesSandcastle, true);
    } finally {
      await service.dispose();
    }
  });

  test('approvePlan runs Sandcastle implementer only after human approval', async () => {
    const calls: Array<{ kind: string; prompt: string }> = [];
    const service = createService({
      runAcpAgent: async (kind, prompt) => {
        calls.push({ kind, prompt });
        if (kind === 'planner') {
          return '<proposed_plan>\nInitial plan\n</proposed_plan>';
        }
        if (kind === 'implementer') {
          return 'implemented in sandcastle';
        }
        return 'reviewed';
      },
    });

    try {
      await service.createPlan('session-1', 'build feature', FEATURE_TEAM_PIPELINE.title);
      const output = await service.approvePlan(
        'session-1',
        '<proposed_plan>\nApproved plan\n</proposed_plan>',
      );

      assert.strictEqual(output, 'reviewed');
      assert.deepStrictEqual(calls.map(call => call.kind), ['planner', 'implementer', 'reviewer', 'tester']);
      assert.ok(calls[1].prompt.includes('<proposed_plan>\nApproved plan\n</proposed_plan>'));
    } finally {
      await service.dispose();
    }
  });

  test('rejectPlan stops before Sandcastle implementer runs', async () => {
    const calls: string[] = [];
    const service = createService({
      runAcpAgent: async (kind) => {
        calls.push(kind);
        return '<proposed_plan>\nPlan\n</proposed_plan>';
      },
    });

    try {
      await service.createPlan('session-1', 'build feature', FEATURE_TEAM_PIPELINE.title);
      service.rejectPlan('session-1');

      assert.deepStrictEqual(calls, ['planner']);
    } finally {
      await service.dispose();
    }
  });

  test('workspace side effects fail when plan was not approved', async () => {
    const engine = createEngine({
      runAcpAgent: async (kind) => {
        if (kind === 'planner') {
          return '<proposed_plan>\nPlan\n</proposed_plan>';
        }
        throw new Error('implementer should not run');
      },
    });

    try {
      await engine.createPlan('session-1', 'build feature', FEATURE_TEAM_PIPELINE.title);

      await assert.rejects(
        () => (engine as any).runConfiguredAcpAgent('session-1', 'implementer', 'prompt'),
        /approved plan/,
      );
    } finally {
      await engine.dispose();
    }
  });

  for (const promotion of ['applied', 'no_changes'] as const) {
    test(`${promotion} continues to reviewer and tester and records a snapshot`, async () => {
      const calls: string[] = [];
      const service = createService({
        runAcpAgent: async (kind) => {
          calls.push(kind);
          if (kind === 'planner') {
            return '<proposed_plan>\nPlan\n</proposed_plan>';
          }
          if (kind === 'implementer') {
            return { text: 'implemented', promotion };
          }
          return 'reviewed';
        },
      });
      try {
        await service.createPlan('session-promotion', 'build feature', FEATURE_TEAM_PIPELINE.title);
        await service.approvePlan('session-promotion', '<proposed_plan>\nPlan\n</proposed_plan>');
        assert.deepStrictEqual(calls, ['planner', 'implementer', 'reviewer', 'tester']);
        assert.strictEqual(service.getLastTeamRunSnapshot()?.implementOutput, 'implemented');
      } finally {
        await service.dispose();
      }
    });
  }

  for (const promotion of ['rejected', 'cancelled'] as const) {
    test(`${promotion} stops before review and does not record a snapshot`, async () => {
      const calls: string[] = [];
      const statuses: string[] = [];
      const service = createService({
        runAcpAgent: async (kind) => {
          calls.push(kind);
          if (kind === 'planner') {
            return '<proposed_plan>\nPlan\n</proposed_plan>';
          }
          return { text: 'not promoted', promotion };
        },
      });
      service.on('status', event => statuses.push(event.status));
      try {
        await service.createPlan('session-stopped', 'build feature', FEATURE_TEAM_PIPELINE.title);
        await service.approvePlan('session-stopped', '<proposed_plan>\nPlan\n</proposed_plan>');
        assert.deepStrictEqual(calls, ['planner', 'implementer']);
        assert.ok(statuses.includes(promotion));
        assert.strictEqual(service.getLastTeamRunSnapshot(), null);
      } finally {
        await service.dispose();
      }
    });
  }

  test('apply failure emits error, skips review, and records no snapshot', async () => {
    const calls: string[] = [];
    const statuses: string[] = [];
    const service = createService({
      runAcpAgent: async (kind) => {
        calls.push(kind);
        if (kind === 'planner') {
          return '<proposed_plan>\nPlan\n</proposed_plan>';
        }
        throw new Error('Sandcastle changes could not be applied.');
      },
    });
    service.on('status', event => statuses.push(event.status));
    try {
      await service.createPlan('session-failed', 'build feature', FEATURE_TEAM_PIPELINE.title);
      await assert.rejects(
        () => service.approvePlan('session-failed', '<proposed_plan>\nPlan\n</proposed_plan>'),
        /could not be applied/,
      );
      assert.deepStrictEqual(calls, ['planner', 'implementer']);
      assert.ok(statuses.includes('error'));
      assert.strictEqual(service.getLastTeamRunSnapshot(), null);
    } finally {
      await service.dispose();
    }
  });
});

function createService(options: {
  runAcpAgent: NonNullable<ConstructorParameters<typeof PipelineService>[1]>['runAcpAgent'];
}): PipelineService {
  return new PipelineService(
    () => '/repo',
    createEngineDependencies(options),
  );
}

function createEngine(options: {
  runAcpAgent: NonNullable<ConstructorParameters<typeof PipelineRunEngine>[1]>['runAcpAgent'];
}): PipelineRunEngine {
  return new PipelineRunEngine(
    () => '/repo',
    createEngineDependencies(options),
  );
}

function createEngineDependencies(options: {
  runAcpAgent: NonNullable<ConstructorParameters<typeof PipelineRunEngine>[1]>['runAcpAgent'];
}): ConstructorParameters<typeof PipelineRunEngine>[1] {
  return {
    getPipelineDefinitions: () => [FEATURE_TEAM_PIPELINE],
    getPipelineDefinitionForAgent: (agentName) =>
      agentName === FEATURE_TEAM_PIPELINE.title ? FEATURE_TEAM_PIPELINE : null,
    getAgentConfigs: () => ({
      'Cursor CLI': { transport: 'acp', command: 'cursor', args: [] },
      'Cursor Sandcastle': { transport: 'sandcastle', provider: 'cursor', model: 'composer-2' },
    }),
    runAcpAgent: options.runAcpAgent,
  };
}
