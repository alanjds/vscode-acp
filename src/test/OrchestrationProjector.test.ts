import * as assert from 'assert';

import {
  applyPipelineStatusToTimeline,
  createDefaultTeamTimeline,
  emptyOrchestrationSlice,
  migratePipelineFromChatHistory,
} from '../../webview/src/app/OrchestrationProjector';
import {
  mapOrchestrationMessageToActions,
  shouldFinalizeTeamRoleTurn,
} from '../../webview/src/app/orchestrationEvents';

suite('OrchestrationProjector', () => {
  const baseTimeline = createDefaultTeamTimeline(false);

  const statusCases: Array<{
    name: string;
    status: string;
    stepId?: string;
    timeline?: ReturnType<typeof createDefaultTeamTimeline>;
    assert: (timeline: ReturnType<typeof applyPipelineStatusToTimeline>) => void;
  }> = [
    {
      name: 'planning',
      status: 'planning',
      assert: timeline => {
        assert.strictEqual(timeline.find(step => step.id === 'planner')?.status, 'running');
      },
    },
    {
      name: 'awaiting_approval',
      status: 'awaiting_approval',
      assert: timeline => {
        assert.strictEqual(timeline.find(step => step.id === 'planner')?.status, 'done');
        assert.strictEqual(timeline.find(step => step.id === 'approval')?.status, 'running');
      },
    },
    {
      name: 'implementing',
      status: 'implementing',
      assert: timeline => {
        assert.strictEqual(timeline.find(step => step.id === 'implementer')?.status, 'running');
      },
    },
    {
      name: 'reviewing',
      status: 'reviewing',
      assert: timeline => {
        assert.strictEqual(timeline.find(step => step.id === 'reviewer')?.status, 'running');
      },
    },
    {
      name: 'testing',
      status: 'testing',
      timeline: createDefaultTeamTimeline(true),
      assert: timeline => {
        assert.strictEqual(timeline.find(step => step.id === 'tester')?.status, 'running');
      },
    },
    {
      name: 'completed',
      status: 'completed',
      assert: timeline => {
        assert.ok(timeline.every(step => step.status === 'done'));
      },
    },
    {
      name: 'rejected approval',
      status: 'rejected',
      assert: timeline => {
        assert.strictEqual(timeline.find(step => step.id === 'approval')?.status, 'error');
      },
    },
    {
      name: 'rejected implementer',
      status: 'rejected',
      stepId: 'implementer',
      assert: timeline => {
        assert.strictEqual(timeline.find(step => step.id === 'implementer')?.status, 'error');
      },
    },
    {
      name: 'error with stepId',
      status: 'error',
      stepId: 'reviewer',
      assert: timeline => {
        assert.strictEqual(timeline.find(step => step.id === 'reviewer')?.status, 'error');
      },
    },
    {
      name: 'cancelled',
      status: 'cancelled',
      timeline: baseTimeline.map(step =>
        step.id === 'implementer' ? { ...step, status: 'running' as const } : step,
      ),
      assert: timeline => {
        assert.strictEqual(timeline.find(step => step.id === 'implementer')?.status, 'skipped');
      },
    },
  ];

  for (const testCase of statusCases) {
    test(`applyPipelineStatusToTimeline handles ${testCase.name}`, () => {
      const timeline = testCase.timeline ?? baseTimeline;
      const next = applyPipelineStatusToTimeline(timeline, testCase.status, testCase.stepId);
      testCase.assert(next);
    });
  }

  test('createDefaultTeamTimeline includes tester when requested', () => {
    assert.strictEqual(createDefaultTeamTimeline(false).some(step => step.id === 'tester'), false);
    assert.strictEqual(createDefaultTeamTimeline(true).some(step => step.id === 'tester'), true);
  });

  test('migratePipelineFromChatHistory moves legacy pipeline items into orchestration slice', () => {
    const orchestration = emptyOrchestrationSlice();
    const chatHistory = [
      { kind: 'message' as const, role: 'user' as const, text: 'hello' },
      {
        kind: 'pipelinePlan' as const,
        plan: 'do work',
        status: 'pending' as const,
      },
      {
        kind: 'pipelineRoleOutput' as const,
        role: 'implementer' as const,
        text: 'done',
        title: 'Implementer',
      },
    ];

    const migrated = migratePipelineFromChatHistory(chatHistory, orchestration);
    assert.strictEqual(migrated.chatHistory.length, 1);
    assert.strictEqual(migrated.orchestration.plan?.plan, 'do work');
    assert.strictEqual(migrated.orchestration.roleOutputs.length, 1);
  });

  test('mapOrchestrationMessageToActions handles pipelinePlanReady', () => {
    const actions = mapOrchestrationMessageToActions(
      {
        type: 'pipelinePlanReady',
        plan: 'ship it',
        teamId: 'team-1',
      },
      baseTimeline,
    );

    assert.ok(actions.some(action => action.type === 'appendPipelinePlan'));
    assert.ok(actions.some(action => action.type === 'updatePipelineTimeline'));
  });

  test('mapOrchestrationMessageToActions handles pipelineStatus', () => {
    const actions = mapOrchestrationMessageToActions(
      {
        type: 'pipelineStatus',
        status: 'implementing',
        teamId: 'team-1',
        role: 'implementer',
        agentName: 'builder',
      },
      baseTimeline,
    );

    assert.ok(actions.some(action => action.type === 'updatePipelinePlanStatus'));
    assert.ok(actions.some(action => action.type === 'updatePipelineTimeline'));
    assert.ok(actions.some(action => action.type === 'setActivePipelineRole'));
  });

  test('mapOrchestrationMessageToActions handles reviewerRerunReady', () => {
    const actions = mapOrchestrationMessageToActions(
      { type: 'reviewerRerunReady', output: 'looks good' },
      baseTimeline,
    );

    assert.deepStrictEqual(actions, [{
      type: 'appendPipelineRoleOutput',
      role: 'reviewer-rerun',
      text: 'looks good',
      title: 'Review (rerun)',
    }]);
  });

  test('shouldFinalizeTeamRoleTurn requires active non-planner role and assistant text', () => {
    assert.strictEqual(shouldFinalizeTeamRoleTurn('planner', 'draft'), false);
    assert.strictEqual(shouldFinalizeTeamRoleTurn('implementer', '   '), false);
    assert.strictEqual(shouldFinalizeTeamRoleTurn('implementer', 'output'), true);
  });
});
