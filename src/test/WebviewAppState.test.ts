import * as assert from 'assert';

import {
  appReducer,
  createInitialState,
  emptyPersistedState,
  emptyOrchestrationSlice,
  selectOrchestrationView,
  shouldAcceptIncomingSharedState,
  type ChatWebviewSharedState,
} from '../../webview/src/testing';

suite('WebviewAppState', () => {
  test('submitUserMessage appends message and clears prompt in one transition', () => {
    const initial = createInitialState(emptyPersistedState());
    const withPrompt = appReducer(initial, { type: 'setPromptText', text: 'hello world' });
    const withPlaceholder = appReducer(withPrompt, {
      type: 'setPlaceholderOverride',
      placeholder: 'custom',
    });
    const withSlashSuppressed = appReducer(withPlaceholder, {
      type: 'suppressSlashPopup',
      promptText: '/cmd',
    });

    const next = appReducer(withSlashSuppressed, { type: 'submitUserMessage', text: 'hello world' });

    assert.strictEqual(next.promptText, '');
    assert.strictEqual(next.placeholderOverride, null);
    assert.strictEqual(next.slashPopupSuppressedFor, null);
    assert.strictEqual(next.isProcessing, true);
    assert.strictEqual(next.persisted.chatHistory.length, 1);
    assert.deepStrictEqual(next.persisted.chatHistory[0], {
      kind: 'message',
      role: 'user',
      text: 'hello world',
    });
  });

  test('appendUserChunk ignores duplicate echo of the last user message', () => {
    const initial = createInitialState(emptyPersistedState());
    const submitted = appReducer(initial, { type: 'submitUserMessage', text: 'hello world' });
    const echoed = appReducer(submitted, { type: 'appendUserChunk', text: 'hello world' });

    assert.strictEqual(echoed.persisted.chatHistory.length, 1);
    assert.strictEqual(
      echoed.persisted.chatHistory[0]?.kind === 'message' ? echoed.persisted.chatHistory[0].text : '',
      'hello world',
    );
  });

  test('hydrateOrchestrationState preserves shared slice', () => {
    const initial = createInitialState(emptyPersistedState());
    const withPrompt = appReducer(initial, { type: 'setPromptText', text: 'draft' });
    const withOrchestration = appReducer(withPrompt, {
      type: 'setActivePipelineRole',
      role: 'implementer',
      agentName: 'coder',
    });

    const hydrated = appReducer(withOrchestration, {
      type: 'hydrateOrchestrationState',
      state: {
        version: 2,
        updatedAt: 200,
        timeline: [{ id: 'planner', label: 'Planner', status: 'done' }],
        activeRole: 'reviewer',
        activeAgentName: 'review-bot',
        plan: null,
        roleOutputs: [],
      },
    });

    assert.strictEqual(hydrated.promptText, 'draft');
    assert.strictEqual(hydrated.orchestration.activeRole, 'reviewer');
    assert.strictEqual(hydrated.orchestration.activeAgentName, 'review-bot');
  });

  test('hydrateSharedState restores promptText without touching orchestration slice', () => {
    const initial = createInitialState(emptyPersistedState());
    const withOrchestration = appReducer(initial, {
      type: 'setActivePipelineRole',
      role: 'implementer',
      agentName: 'coder',
    });
    const cleared = appReducer(withOrchestration, { type: 'submitUserMessage', text: 'sent' });

    const snapshot: ChatWebviewSharedState = {
      version: 2,
      updatedAt: 200,
      chatHistory: cleared.persisted.chatHistory,
      sessionState: null,
      hasActiveSession: false,
      promptText: 'restored draft',
      inputAreaHeight: cleared.inputAreaHeight,
      isProcessing: false,
      currentTurn: null,
      collapsedTools: {},
      composerUnlocked: false,
    };

    const hydrated = appReducer(cleared, { type: 'hydrateSharedState', state: snapshot });
    assert.strictEqual(hydrated.promptText, 'restored draft');
    assert.strictEqual(hydrated.orchestration.activeRole, 'implementer');
    assert.strictEqual(hydrated.orchestration.activeAgentName, 'coder');
  });

  test('createInitialState restores orchestration from serializer bundle', () => {
    const state = createInitialState({
      shared: {
        version: 1,
        updatedAt: 100,
        chatHistory: [],
        sessionState: null,
        hasActiveSession: false,
        promptText: '',
        inputAreaHeight: 140,
        isProcessing: false,
        currentTurn: null,
        collapsedTools: {},
      },
      orchestration: {
        timeline: [{ id: 'planner', label: 'Plan', status: 'done' }],
        activeRole: 'implementer',
        activeAgentName: 'builder',
      },
    });

    assert.strictEqual(state.orchestration.activeRole, 'implementer');
    assert.strictEqual(selectOrchestrationView(state).hasTimeline, true);
  });

  test('createInitialState migrates legacy pipeline fields from shared snapshot', () => {
    const state = createInitialState({
      version: 1,
      updatedAt: 100,
      chatHistory: [],
      sessionState: null,
      hasActiveSession: false,
      promptText: '',
      inputAreaHeight: 140,
      isProcessing: false,
      currentTurn: null,
      collapsedTools: {},
      pipelineTimeline: [{ id: 'reviewer', label: 'Review', status: 'running' }],
      activePipelineRole: 'reviewer',
      activePipelineAgentName: 'review-bot',
    });

    assert.strictEqual(state.orchestration.activeRole, 'reviewer');
    assert.strictEqual(state.orchestration.timeline.length, 1);
  });

  test('finalizeTeamRoleTurn appends pipeline output without standard prompt commit', () => {
    let state = createInitialState(emptyPersistedState());
    state = appReducer(state, { type: 'promptStart', turnId: 'turn-1' });
    state = appReducer(state, { type: 'appendAssistantChunk', text: 'implemented feature' });
    state = appReducer(state, {
      type: 'setActivePipelineRole',
      role: 'implementer',
      agentName: 'builder',
    });

    const next = appReducer(state, { type: 'finalizeTeamRoleTurn' });

    assert.strictEqual(next.currentTurn, null);
    assert.strictEqual(next.isProcessing, false);
    assert.strictEqual(next.persisted.chatHistory.length, 0);
    assert.strictEqual(next.orchestration.roleOutputs.length, 1);
    assert.strictEqual(next.orchestration.roleOutputs[0]?.role, 'implementer');
  });

  test('clearChat resets orchestration slice', () => {
    let state = createInitialState(emptyPersistedState());
    state = appReducer(state, {
      type: 'updatePipelineTimeline',
      timeline: [{ id: 'planner', label: 'Plan', status: 'running' }],
    });

    const cleared = appReducer(state, { type: 'clearChat' });
    assert.deepStrictEqual(cleared.orchestration, emptyOrchestrationSlice());
  });

  test('shared snapshot guard rejects older versions', () => {
    const localVersion = 5;
    const localUpdatedAt = 500;
    const current = { version: localVersion, updatedAt: localUpdatedAt };

    const olderVersion = { version: 4, updatedAt: 600 };
    const sameVersionOlderTime = { version: 5, updatedAt: 400 };
    const sameVersionSameTime = { version: 5, updatedAt: 500 };
    const newer = { version: 5, updatedAt: 501 };

    assert.strictEqual(shouldAcceptIncomingSharedState(current, olderVersion), false);
    assert.strictEqual(shouldAcceptIncomingSharedState(current, sameVersionOlderTime), false);
    assert.strictEqual(shouldAcceptIncomingSharedState(current, sameVersionSameTime), false);
    assert.strictEqual(shouldAcceptIncomingSharedState(current, newer), true);
  });
});
