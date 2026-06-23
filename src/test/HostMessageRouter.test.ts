import * as assert from 'assert';

import { routeHostMessage } from '../../webview/src/app/hostMessageRouter';
import {
  appReducer,
  createInitialState,
  emptyPersistedState,
} from '../../webview/src/testing';

suite('HostMessageRouter', () => {
  test('pipelineStatus maps to orchestration actions', () => {
    let state = createInitialState(emptyPersistedState());
    state = appReducer(state, {
      type: 'updatePipelineTimeline',
      timeline: [
        { id: 'planner', label: 'Planner', status: 'done' },
        { id: 'approval', label: 'Approval', status: 'done' },
        { id: 'implementer', label: 'Implementer', status: 'pending' },
        { id: 'reviewer', label: 'Reviewer', status: 'pending' },
      ],
    });

    const result = routeHostMessage(
      {
        type: 'pipelineStatus',
        status: 'implementing',
        teamId: 'team-1',
        role: 'implementer',
        agentName: 'builder',
      },
      {
        getState: () => state,
        refs: {
          sharedVersion: 0,
          sharedUpdatedAt: 0,
          orchestrationVersion: 0,
          orchestrationUpdatedAt: 0,
          fileSearchRequestId: 0,
          turnCounter: 0,
        },
      },
    );

    assert.ok(result.actions.some(action => action.type === 'setActivePipelineRole'));
    assert.ok(result.actions.some(action => action.type === 'updatePipelineTimeline'));
  });

  test('hydrateSharedState rejection returns no actions for stale snapshot', () => {
    const result = routeHostMessage(
      {
        type: 'hydrateSharedState',
        state: {
          version: 1,
          updatedAt: 100,
          chatHistory: [],
          sessionState: null,
          hasActiveSession: false,
          promptText: 'stale',
          inputAreaHeight: 140,
          isProcessing: false,
          currentTurn: null,
          collapsedTools: {},
        },
      },
      {
        getState: () => createInitialState(emptyPersistedState()),
        refs: {
          sharedVersion: 5,
          sharedUpdatedAt: 500,
          orchestrationVersion: 0,
          orchestrationUpdatedAt: 0,
          fileSearchRequestId: 0,
          turnCounter: 0,
        },
      },
    );

    assert.strictEqual(result.actions.length, 0);
  });

  test('promptEnd finalizes team role turn when assistant output exists', () => {
    let state = createInitialState(emptyPersistedState());
    state = appReducer(state, { type: 'promptStart', turnId: 'turn-1' });
    state = appReducer(state, { type: 'appendAssistantChunk', text: 'done' });
    state = appReducer(state, {
      type: 'setActivePipelineRole',
      role: 'implementer',
      agentName: 'builder',
    });

    const result = routeHostMessage(
      { type: 'promptEnd' },
      {
        getState: () => state,
        refs: {
          sharedVersion: 0,
          sharedUpdatedAt: 0,
          orchestrationVersion: 0,
          orchestrationUpdatedAt: 0,
          fileSearchRequestId: 0,
          turnCounter: 0,
        },
      },
    );

    assert.deepStrictEqual(result.actions, [{ type: 'finalizeTeamRoleTurn' }]);
  });

  test('sessionUpdate maps to chat actions', () => {
    const result = routeHostMessage(
      {
        type: 'sessionUpdate',
        update: {
          sessionUpdate: 'agent_message_chunk',
          content: { type: 'text', text: 'hello' },
        },
      },
      {
        getState: () => createInitialState(emptyPersistedState()),
        refs: {
          sharedVersion: 0,
          sharedUpdatedAt: 0,
          orchestrationVersion: 0,
          orchestrationUpdatedAt: 0,
          fileSearchRequestId: 0,
          turnCounter: 0,
        },
      },
    );

    assert.ok(result.actions.some(action => action.type === 'appendAssistantChunk'));
  });
});
