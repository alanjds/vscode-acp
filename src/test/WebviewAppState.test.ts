import * as assert from 'assert';

import { appReducer, createInitialState, emptyPersistedState } from '../../webview/src/app/state';
import type { ChatWebviewSharedState } from '../../webview/src/chatTypes';

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

  test('hydrateSharedState restores promptText from newer snapshot', () => {
    const initial = createInitialState(emptyPersistedState());
    const cleared = appReducer(initial, { type: 'submitUserMessage', text: 'sent' });

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
      pipelineTimeline: [],
      activePipelineRole: null,
      activePipelineAgentName: null,
      composerUnlocked: false,
    };

    const hydrated = appReducer(cleared, { type: 'hydrateSharedState', state: snapshot });
    assert.strictEqual(hydrated.promptText, 'restored draft');
  });

  test('stale shared snapshot guard rejects older versions', () => {
    const localVersion = 5;
    const localUpdatedAt = 500;

    const olderVersion = { version: 4, updatedAt: 600 };
    const sameVersionOlderTime = { version: 5, updatedAt: 400 };
    const sameVersionSameTime = { version: 5, updatedAt: 500 };
    const newer = { version: 5, updatedAt: 501 };

    const isStale = (incoming: { version: number; updatedAt: number }) =>
      incoming.version < localVersion
      || (incoming.version === localVersion && incoming.updatedAt <= localUpdatedAt);

    assert.strictEqual(isStale(olderVersion), true);
    assert.strictEqual(isStale(sameVersionOlderTime), true);
    assert.strictEqual(isStale(sameVersionSameTime), true);
    assert.strictEqual(isStale(newer), false);
  });
});
