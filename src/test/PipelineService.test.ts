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

  // ============ New tests ============

  test('createPlan emits planning, plan-ready, awaiting_approval in order', async () => {
    const events: string[] = [];
    const service = new PipelineService(
      () => '/repo',
      {
        getPipelineConfig: () => PIPELINE_CONFIG,
        getAgentConfigs: () => ({ Codex: {}, Vibe: {} }),
        runAcpAgent: async (_kind, _prompt) => {
          return '<proposed_plan>\nImplement it\n</proposed_plan>';
        },
      },
    );

    service.on('status', (event: any) => {
      events.push(event.status);
    });
    service.on('plan-ready', () => {
      events.push('plan-ready');
    });

    try {
      await service.createPlan('session-1', 'build feature');

      assert.deepStrictEqual(events, ['planning', 'plan-ready', 'awaiting_approval']);
    } finally {
      await service.dispose();
    }
  });

  test('second createPlan on same session sends previous plan and user feedback to planner', async () => {
    const calls: Array<{ kind: string; prompt: string }> = [];
    const service = new PipelineService(
      () => '/repo',
      {
        getPipelineConfig: () => PIPELINE_CONFIG,
        getAgentConfigs: () => ({ Codex: {}, Vibe: {} }),
        runAcpAgent: async (kind, prompt) => {
          calls.push({ kind, prompt });
          return '<proposed_plan>\nNew plan\n</proposed_plan>';
        },
      },
    );

    try {
      await service.createPlan('session-1', 'build feature');
      await service.createPlan('session-1', 'revise plan');

      assert.strictEqual(calls.length, 2);
      assert.strictEqual(calls[0].kind, 'planner');
      assert.ok(calls[1].prompt.includes('Previous plan:'));
      assert.ok(calls[1].prompt.includes('<proposed_plan>'));
      assert.ok(calls[1].prompt.includes('</proposed_plan>'));
      assert.ok(calls[1].prompt.includes('User feedback/request:'));
      assert.ok(calls[1].prompt.includes('revise plan'));
      assert.ok(calls[1].prompt.includes('Original request:'));
      assert.ok(calls[1].prompt.includes('build feature'));
    } finally {
      await service.dispose();
    }
  });

  test('createPlan rejects when planner returns zero proposed_plan blocks', async () => {
    const service = new PipelineService(
      () => '/repo',
      {
        getPipelineConfig: () => PIPELINE_CONFIG,
        getAgentConfigs: () => ({ Codex: {}, Vibe: {} }),
        runAcpAgent: async () => 'No plan here',
      },
    );

    const events: string[] = [];
    service.on('status', (event: any) => {
      events.push(event.status);
    });
    service.on('error', () => {
      events.push('error');
    });

    try {
      await assert.rejects(
        () => service.createPlan('session-1', 'build feature'),
        /did not include/,
      );

      assert.ok(events.includes('error'));
    } finally {
      await service.dispose();
    }
  });

  test('createPlan rejects when planner returns multiple proposed_plan blocks', async () => {
    const service = new PipelineService(
      () => '/repo',
      {
        getPipelineConfig: () => PIPELINE_CONFIG,
        getAgentConfigs: () => ({ Codex: {}, Vibe: {} }),
        runAcpAgent: async () => '<proposed_plan>\nA\n</proposed_plan><proposed_plan>\nB\n</proposed_plan>',
      },
    );

    const events: string[] = [];
    service.on('status', (event: any) => {
      events.push(event.status);
    });
    service.on('error', () => {
      events.push('error');
    });

    try {
      await assert.rejects(
        () => service.createPlan('session-1', 'build feature'),
        /expected exactly one/,
      );

      assert.ok(events.includes('error'));
    } finally {
      await service.dispose();
    }
  });

  test('approvePlan rejects when plan contains text outside proposed_plan block', async () => {
    const service = new PipelineService(
      () => '/repo',
      {
        getPipelineConfig: () => PIPELINE_CONFIG,
        getAgentConfigs: () => ({ Codex: {}, Vibe: {} }),
        runAcpAgent: async () => '<proposed_plan>\nPlan\n</proposed_plan>',
      },
    );

    try {
      await service.createPlan('session-1', 'build feature');

      await assert.rejects(
        () => service.approvePlan('session-1', 'Intro text\n<proposed_plan>\nPlan\n</proposed_plan>'),
        /must contain only/,
      );
    } finally {
      await service.dispose();
    }
  });

  test('approvePlan emits implementing, calls implementer, emits completed, cleans state', async () => {
    const events: string[] = [];
    const service = new PipelineService(
      () => '/repo',
      {
        getPipelineConfig: () => PIPELINE_CONFIG,
        getAgentConfigs: () => ({ Codex: {}, Vibe: {} }),
        runAcpAgent: async (kind, _prompt) => {
          if (kind === 'planner') {
            return '<proposed_plan>\nImplement it\n</proposed_plan>';
          }
          return 'implemented successfully';
        },
      },
    );

    service.on('status', (event: any) => {
      events.push(event.status);
    });

    try {
      await service.createPlan('session-1', 'build feature');
      await service.approvePlan('session-1', '<proposed_plan>\nImplement it\n</proposed_plan>');

      assert.ok(events.includes('implementing'));
      assert.ok(events.includes('completed'));

      // State should be cleaned - subsequent approve should fail
      await assert.rejects(
        () => service.approvePlan('session-1', '<proposed_plan>\nNew plan\n</proposed_plan>'),
        /No pending pipeline plan/,
      );
    } finally {
      await service.dispose();
    }
  });

  test('approvePlan emits error and rejects when implementer fails', async () => {
    const events: string[] = [];
    const service = new PipelineService(
      () => '/repo',
      {
        getPipelineConfig: () => PIPELINE_CONFIG,
        getAgentConfigs: () => ({ Codex: {}, Vibe: {} }),
        runAcpAgent: async (kind) => {
          if (kind === 'planner') {
            return '<proposed_plan>\nPlan\n</proposed_plan>';
          }
          throw new Error('Implementer failed');
        },
      },
    );

    service.on('status', (event: any) => {
      events.push(event.status);
    });

    try {
      await service.createPlan('session-1', 'build feature');

      await assert.rejects(
        () => service.approvePlan('session-1', '<proposed_plan>\nPlan\n</proposed_plan>'),
        /Implementer failed/,
      );

      assert.ok(events.includes('error'));

      // State should be cleaned
      await assert.rejects(
        () => service.approvePlan('session-1', '<proposed_plan>\nNew plan\n</proposed_plan>'),
        /No pending pipeline plan/,
      );
    } finally {
      await service.dispose();
    }
  });

  test('rejectPlan emits rejected and cleans state', async () => {
    const events: string[] = [];
    const service = new PipelineService(
      () => '/repo',
      {
        getPipelineConfig: () => PIPELINE_CONFIG,
        getAgentConfigs: () => ({ Codex: {}, Vibe: {} }),
        runAcpAgent: async () => '<proposed_plan>\nPlan\n</proposed_plan>',
      },
    );

    service.on('status', (event: any) => {
      events.push(event.status);
    });

    try {
      await service.createPlan('session-1', 'build feature');
      service.rejectPlan('session-1');

      assert.ok(events.includes('rejected'));

      // State should be cleaned
      await assert.rejects(
        () => service.approvePlan('session-1', '<proposed_plan>\nNew plan\n</proposed_plan>'),
        /No pending pipeline plan/,
      );
    } finally {
      await service.dispose();
    }
  });

  test('cancel emits cancelled, marks state cancelled, cleans state, and subsequent approval rejects', async () => {
    const events: string[] = [];
    const service = new PipelineService(
      () => '/repo',
      {
        getPipelineConfig: () => PIPELINE_CONFIG,
        getAgentConfigs: () => ({ Codex: {}, Vibe: {} }),
        runAcpAgent: async () => '<proposed_plan>\nPlan\n</proposed_plan>',
      },
    );

    service.on('status', (event: any) => {
      events.push(event.status);
    });

    try {
      await service.createPlan('session-1', 'build feature');
      service.cancel('session-1');

      assert.ok(events.includes('cancelled'));

      // State should be cleaned and marked cancelled
      await assert.rejects(
        () => service.approvePlan('session-1', '<proposed_plan>\nPlan\n</proposed_plan>'),
        /No pending pipeline plan/,
      );
    } finally {
      await service.dispose();
    }
  });

  test('dispose cancels all runs, emits cancelled for each, clears listeners', async () => {
    const events: Array<{ sessionId: string; status: string }> = [];
    const service = new PipelineService(
      () => '/repo',
      {
        getPipelineConfig: () => PIPELINE_CONFIG,
        getAgentConfigs: () => ({ Codex: {}, Vibe: {} }),
        runAcpAgent: async () => '<proposed_plan>\nPlan\n</proposed_plan>',
      },
    );

    service.on('status', (event: any) => {
      events.push({ sessionId: event.sessionId, status: event.status });
    });

    try {
      await service.createPlan('session-1', 'build feature');
      await service.createPlan('session-2', 'another feature');

      // Should have 2 runs pending
      assert.strictEqual(events.filter(e => e.status === 'awaiting_approval').length, 2);

      await service.dispose();

      // Should have emitted cancelled for both
      assert.strictEqual(events.filter(e => e.status === 'cancelled').length, 2);

      // Listeners should be cleared
      const listenerCount = service.listenerCount('status');
      assert.strictEqual(listenerCount, 0);
    } finally {
      // Service already disposed
    }
  });

  test('dispose removes all runs and leaves no reusable runs', async () => {
    const service = new PipelineService(
      () => '/repo',
      {
        getPipelineConfig: () => PIPELINE_CONFIG,
        getAgentConfigs: () => ({ Codex: {}, Vibe: {} }),
        runAcpAgent: async () => '<proposed_plan>\nPlan\n</proposed_plan>',
      },
    );

    try {
      await service.createPlan('session-1', 'build feature');
      await service.dispose();

      // Try to create a new plan - should work since dispose was called
      // But the old run should be gone
      await service.createPlan('session-2', 'new feature');
      // This should work fine
    } finally {
      await service.dispose();
    }
  });

  test('createPlan with onSessionUpdate emits session-update event', async () => {
    const events: Array<{ type: string; sessionId: string }> = [];
    const service = new PipelineService(
      () => '/repo',
      {
        getPipelineConfig: () => PIPELINE_CONFIG,
        getAgentConfigs: () => ({ Codex: {}, Vibe: {} }),
        runAcpAgent: async (kind, prompt, onSessionUpdate) => {
          if (kind === 'implementer' && onSessionUpdate) {
            onSessionUpdate({ sessionId: 'session-1', update: { sessionUpdate: 'test' } } as any);
          }
          return '<proposed_plan>\nPlan\n</proposed_plan>';
        },
      },
    );

    service.on('session-update', (event: any) => {
      events.push({ type: 'session-update', sessionId: event.sessionId });
    });

    try {
      await service.createPlan('session-1', 'build feature');
      await service.approvePlan('session-1', '<proposed_plan>\nPlan\n</proposed_plan>');

      assert.strictEqual(events.length, 1);
      assert.strictEqual(events[0].sessionId, 'session-1');
    } finally {
      await service.dispose();
    }
  });
});
