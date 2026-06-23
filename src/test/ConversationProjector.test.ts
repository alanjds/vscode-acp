import * as assert from 'assert';

import { DefaultConversationProjector } from '../core/ConversationProjector';

const projector = new DefaultConversationProjector();

function ctx(activeSessionId: string | null, loadingSessions: Set<string> = new Set()) {
  return {
    activeSessionId,
    isLoading: (sessionId: string) => loadingSessions.has(sessionId),
  };
}

function agentChunk(sessionId: string, text: string) {
  return {
    sessionId,
    update: {
      sessionUpdate: 'agent_message_chunk',
      content: { type: 'text', text },
    },
  } as any;
}

suite('ConversationProjector', () => {
  test('acp agent_message_chunk active → assistant chunk, sessionUpdate, shouldForward true', () => {
    const notification = agentChunk('session-1', 'hello');
    const projection = projector.project(
      { kind: 'acp-session-update', notification },
      ctx('session-1'),
    );

    assert.strictEqual(projection.sessionEffects.assistantMessageChunk, 'hello');
    assert.strictEqual(projection.shouldForwardToActiveConversation, true);
    assert.deepStrictEqual(projection.webviewMessages, [{
      type: 'sessionUpdate',
      update: notification.update,
      sessionId: 'session-1',
    }]);
  });

  test('acp agent_message_chunk inactive → assistant chunk, no webview messages', () => {
    const notification = agentChunk('session-1', 'hello');
    const projection = projector.project(
      { kind: 'acp-session-update', notification },
      ctx('session-2'),
    );

    assert.strictEqual(projection.sessionEffects.assistantMessageChunk, 'hello');
    assert.strictEqual(projection.shouldForwardToActiveConversation, false);
    assert.deepStrictEqual(projection.webviewMessages, []);
  });

  test('acp available_commands_update → commands effect, sessionUpdate when active', () => {
    const notification = {
      sessionId: 'session-1',
      update: {
        sessionUpdate: 'available_commands_update',
        availableCommands: [{ name: 'review', description: 'Review code' }],
      },
    } as any;
    const projection = projector.project(
      { kind: 'acp-session-update', notification },
      ctx('session-1'),
    );

    assert.deepStrictEqual(projection.sessionEffects.availableCommands, [
      { name: 'review', description: 'Review code' },
    ]);
    assert.strictEqual(projection.webviewMessages.length, 1);
    assert.strictEqual(projection.webviewMessages[0]?.type, 'sessionUpdate');
  });

  test('acp user_message_chunk + isLoading true → replayedUserMessageChunk', () => {
    const notification = {
      sessionId: 'session-1',
      update: {
        sessionUpdate: 'user_message_chunk',
        content: { type: 'text', text: 'replayed' },
      },
    } as any;
    const projection = projector.project(
      { kind: 'acp-session-update', notification },
      ctx('session-1', new Set(['session-1'])),
    );

    assert.strictEqual(projection.sessionEffects.replayedUserMessageChunk, 'replayed');
  });

  test('acp user_message_chunk + isLoading false → no replayed chunk', () => {
    const notification = {
      sessionId: 'session-1',
      update: {
        sessionUpdate: 'user_message_chunk',
        content: { type: 'text', text: 'ignored' },
      },
    } as any;
    const projection = projector.project(
      { kind: 'acp-session-update', notification },
      ctx('session-1'),
    );

    assert.strictEqual(projection.sessionEffects.replayedUserMessageChunk, undefined);
  });

  test('pipeline-session-update matches acp sessionEffects and enriches sessionUpdate', () => {
    const update = agentChunk('session-1', 'planner says hi');
    const acpProjection = projector.project(
      { kind: 'acp-session-update', notification: update },
      ctx('session-1'),
    );
    const pipelineProjection = projector.project(
      {
        kind: 'pipeline-session-update',
        event: {
          sessionId: 'session-1',
          phase: 'planner',
          update,
          role: 'planner',
          agentName: 'planner-agent',
          teamId: 'feature-team',
        },
      },
      ctx('session-1'),
    );

    assert.deepStrictEqual(
      pipelineProjection.sessionEffects,
      acpProjection.sessionEffects,
    );
    assert.deepStrictEqual(pipelineProjection.webviewMessages, [{
      type: 'sessionUpdate',
      update: update.update,
      sessionId: 'session-1',
      phase: 'planner',
      role: 'planner',
      agentName: 'planner-agent',
      teamId: 'feature-team',
    }]);
  });

  test('pipeline-plan-ready with plan → assistant chunk + pipelinePlanReady when active', () => {
    const projection = projector.project(
      {
        kind: 'pipeline-plan-ready',
        event: {
          sessionId: 'session-1',
          plan: '<proposed_plan>do work</proposed_plan>',
          stepId: 'plan',
          role: 'planner',
          agentName: 'planner-agent',
          teamId: 'feature-team',
          implementerUsesSandcastle: true,
        },
      },
      ctx('session-1'),
    );

    assert.strictEqual(
      projection.sessionEffects.assistantMessageChunk,
      '<proposed_plan>do work</proposed_plan>',
    );
    assert.deepStrictEqual(projection.webviewMessages, [{
      type: 'pipelinePlanReady',
      plan: '<proposed_plan>do work</proposed_plan>',
      role: 'planner',
      agentName: 'planner-agent',
      teamId: 'feature-team',
      implementerUsesSandcastle: true,
      revised: false,
    }]);
  });

  test('pipeline-plan-ready revised → revised flag on webview message', () => {
    const projection = projector.project(
      {
        kind: 'pipeline-plan-ready',
        event: {
          sessionId: 'session-1',
          plan: 'revised plan',
          stepId: 'plan',
          revised: true,
        },
      },
      ctx('session-1'),
    );

    assert.strictEqual(projection.webviewMessages[0]?.type, 'pipelinePlanReady');
    assert.strictEqual((projection.webviewMessages[0] as any).revised, true);
  });

  test('pipeline-plan-ready inactive session still records plan in sessionEffects', () => {
    const projection = projector.project(
      {
        kind: 'pipeline-plan-ready',
        event: {
          sessionId: 'session-1',
          plan: 'background plan',
          stepId: 'plan',
        },
      },
      ctx('session-2'),
    );

    assert.strictEqual(projection.sessionEffects.assistantMessageChunk, 'background plan');
    assert.deepStrictEqual(projection.webviewMessages, []);
    assert.strictEqual(projection.shouldForwardToActiveConversation, false);
  });

  test('pipeline-status inactive → no webview messages', () => {
    const projection = projector.project(
      {
        kind: 'pipeline-status',
        event: {
          sessionId: 'session-1',
          status: 'planning',
          message: 'Planning',
        },
      },
      ctx('session-2'),
    );

    assert.deepStrictEqual(projection.webviewMessages, []);
    assert.deepStrictEqual(projection.sessionEffects, { sessionId: 'session-1' });
  });

  test('pipeline-status active → pipelineStatus message with team metadata', () => {
    const projection = projector.project(
      {
        kind: 'pipeline-status',
        event: {
          sessionId: 'session-1',
          status: 'implementing',
          message: 'Implementing',
          stepId: 'implement',
          role: 'implementer',
          agentName: 'coder',
          teamId: 'feature-team',
          implementerUsesSandcastle: true,
        },
      },
      ctx('session-1'),
    );

    assert.deepStrictEqual(projection.webviewMessages, [{
      type: 'pipelineStatus',
      status: 'implementing',
      message: 'Implementing',
      stepId: 'implement',
      role: 'implementer',
      agentName: 'coder',
      teamId: 'feature-team',
      implementerUsesSandcastle: true,
    }]);
  });
});
