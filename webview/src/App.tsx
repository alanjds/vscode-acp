import {
  useEffect,
  useCallback,
  useMemo,
  useReducer,
  useRef,
  useState,
  type JSX,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from 'react';

import type {
  ConfigOptionValue,
  FileSearchResult,
  ModelOption,
  ModeOption,
  PipelinePhase,
  PipelinePlanStatus,
  PersistedWebviewState,
  SelectedFileMention,
  SessionConfigOption,
  SlashCommand,
} from './chatTypes';
import {
  expandFileMentionsForPrompt,
  getActiveFileMention,
  getBasePlaceholder,
  getSlashFilteredCommands,
  replaceActiveFileMention,
  type ActiveFileMention,
} from './app/composer';
import { buildHistoryBlocks, getPromptEndMarkdownItem, getRestoreMarkdownItems, getToolCollapseState } from './app/history';
import {
  normalizeConfigOptions,
  normalizeMarkdownRenderedItems,
  normalizeModelsState,
  normalizeModesState,
  normalizeSessionSnapshot,
  normalizeSessionUpdate,
} from './app/normalizers';
import { mapSessionUpdateToActions } from './app/sessionUpdates';
import { appReducer, createInitialState } from './app/state';
import { MessageBubble } from './components/MessageBubble';
import { MarkdownEditor } from './components/MarkdownEditor';
import { MarkdownDisplay } from './components/MarkdownDisplay';
import { PlanBlock } from './components/PlanBlock';
import { PipelinePlanBlock } from './components/PipelinePlanBlock';
import { TurnBlock } from './components/TurnBlock';
import { getState, onMessage, postMessage, setState } from './vscode';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useFileMentions } from './app/useFileMentions';
import { useSessionDisplay } from './app/useSessionDisplay';

export function App(): JSX.Element {
  const [state, dispatch] = useReducer(appReducer, getState<PersistedWebviewState>(), createInitialState);
  const [cursorPosition, setCursorPosition] = useState(0);
  
  const stateRef = useRef(state);
  const restoreMarkdownItemsRef = useRef(getRestoreMarkdownItems(state.persisted.chatHistory));
  const turnCounterRef = useRef(0);
  const loadMarkdownRequestedRef = useRef(false);
  const messagesRef = useRef<HTMLDivElement | null>(null);
  const promptInputRef = useRef<HTMLDivElement | null>(null);
  const slashPopupRef = useRef<HTMLDivElement | null>(null);
  const filePopupRef = useRef<HTMLDivElement | null>(null);
  const pendingCursorPositionRef = useRef<number | null>(null);

  stateRef.current = state;

  const sessionState = state.persisted.sessionState;
  const availableCommands = sessionState?.availableCommands ?? [];

  // Use custom hooks for extracted logic
  const {
    activeFileMention,
    fileMentionKey,
    fileSearchKey,
    fileResults,
    fileSelectedIdx,
    suppressedFileMention,
    selectedFileMentions,
    isFilePopupOpen,
    fileSearchRequestIdRef,
    setFileResults,
    setFileSelectedIdx,
    setSuppressedFileMention,
    setSelectedFileMentions,
    selectFileResult,
  } = useFileMentions({ promptText: state.promptText, cursorPosition });

  const {
    basePlaceholder,
    slashFilteredCommands,
    currentMode,
    currentModel,
    placeholder,
    isSlashPopupOpen,
  } = useSessionDisplay({
    sessionState,
    availableCommands,
    promptText: state.promptText,
    placeholderOverride: state.placeholderOverride,
    slashPopupSuppressedFor: state.slashPopupSuppressedFor,
  });

  const disabledBySession =
    state.isLoadingSession || (!state.persisted.hasActiveSession && !state.composerUnlocked);
  const excludedToolIndexes = useMemo(
    () => new Set(state.currentTurn?.historyToolCallIndexes ?? []),
    [state.currentTurn?.historyToolCallIndexes],
  );
  const historyBlocks = useMemo(
    () => buildHistoryBlocks(state.persisted.chatHistory, excludedToolIndexes),
    [excludedToolIndexes, state.persisted.chatHistory],
  );

  // Sync state to extension
  useEffect(() => {
    setState(state.persisted);
  }, [state.persisted]);

  // Handle markdown rendering (désactivé - rendu côté frontend avec react-markdown)
  useEffect(() => {
    if (!loadMarkdownRequestedRef.current || state.isLoadingSession) {
      return;
    }
    loadMarkdownRequestedRef.current = false;
  }, [state.isLoadingSession, state.persisted.chatHistory]);

  // Handle restored markdown items (désactivé - rendu côté frontend)
  useEffect(() => {
    restoreMarkdownItemsRef.current = [];
    postMessage({ type: 'ready' });

    return onMessage((message) => {
      switch (message.type) {
        case 'state':
          if (message.session) {
            dispatch({
              type: 'showSessionConnected',
              session: normalizeSessionSnapshot(message.session) ?? {},
            });
          } else {
            dispatch({ type: 'showNoSession' });
          }
          break;

        case 'externalUserMessage':
          if (typeof message.text === 'string') {
            dispatch({ type: 'appendUserMessage', text: message.text });
          }
          break;

        case 'fileSearchResults':
          if (
            typeof message.requestId === 'number' &&
            message.requestId === fileSearchRequestIdRef.current &&
            Array.isArray(message.results)
          ) {
            setFileResults(
              message.results.filter((result): result is FileSearchResult =>
                typeof result?.path === 'string' && typeof result?.name === 'string',
              ),
            );
            setFileSelectedIdx(0);
          }
          break;

        case 'promptStart':
          turnCounterRef.current += 1;
          dispatch({
            type: 'promptStart',
            turnId: `turn-${Date.now()}-${turnCounterRef.current}`,
          });
          break;

        case 'promptEnd': {
          dispatch({ type: 'promptEnd' });
          break;
        }

        case 'clearChat':
          dispatch({ type: 'clearChat' });
          break;

        case 'error':
          dispatch({
            type: 'appendErrorMessage',
            text: typeof message.message === 'string' ? message.message : 'An error occurred',
          });
          break;

        case 'info':
          dispatch({
            type: 'appendInfoMessage',
            text: typeof message.message === 'string' ? message.message : 'Information',
          });
          break;

        case 'pipelinePlanReady':
          if (typeof message.plan === 'string') {
            dispatch({ type: 'appendPipelinePlan', plan: message.plan });
          }
          break;

        case 'pipelineStatus': {
          const status = normalizePipelineStatus(message.status);
          if (status) {
            dispatch({
              type: 'updatePipelinePlanStatus',
              status,
              message: typeof message.message === 'string' ? message.message : undefined,
            });
          }
          break;
        }

        case 'sessionUpdate':
          for (const action of mapSessionUpdateToActions(
            normalizeSessionUpdate(message.update),
            normalizePipelinePhase(message.phase),
          )) {
            dispatch(action);
          }
          break;

        case 'modesUpdate': {
          const modes = normalizeModesState(message.modes);
          if (modes) {
            dispatch({ type: 'updateModes', modes });
          }
          break;
        }

        case 'modelsUpdate': {
          const models = normalizeModelsState(message.models);
          if (models) {
            dispatch({ type: 'updateModels', models });
          }
          break;
        }

        case 'configOptionsUpdate':
          dispatch({
            type: 'updateConfigOptions',
            configOptions: normalizeConfigOptions(message.configOptions),
          });
          break;

        case 'loadSessionStart':
          dispatch({ type: 'loadSessionStart' });
          break;

        case 'loadSessionEnd':
          loadMarkdownRequestedRef.current = true;
          dispatch({ type: 'loadSessionEnd', ok: Boolean(message.ok) });
          break;

        case 'sessionInfoUpdate':
          dispatch({
            type: 'updateSessionTitle',
            title: typeof message.title === 'string' ? message.title : null,
          });
          break;
      }
    });
  }, []);

  // Handle file mention changes
  useEffect(() => {
    if (!activeFileMention) {
      setFileResults([]);
      setFileSelectedIdx(0);
      setSuppressedFileMention(null);
      return;
    }

    if (suppressedFileMention === fileMentionKey) {
      setFileResults([]);
      setFileSelectedIdx(0);
      return;
    }

    setFileResults([]);
    setFileSelectedIdx(0);
    if (suppressedFileMention && suppressedFileMention !== fileMentionKey) {
      setSuppressedFileMention(null);
    }

    const requestId = fileSearchRequestIdRef.current + 1;
    fileSearchRequestIdRef.current = requestId;
    postMessage({ type: 'searchFiles', query: activeFileMention.query, requestId });
  }, [fileSearchKey, activeFileMention, suppressedFileMention, fileMentionKey]);

  // Scroll selected file item into view
  useEffect(() => {
    const selectedItem = filePopupRef.current?.querySelector<HTMLElement>(
      `.file-popup-item[data-index="${fileSelectedIdx}"]`,
    );
    selectedItem?.scrollIntoView({ block: 'nearest' });
  }, [fileSelectedIdx, isFilePopupOpen]);

  // Scroll selected slash command into view
  useEffect(() => {
    const selectedItem = slashPopupRef.current?.querySelector<HTMLElement>(
      `.slash-popup-item[data-index="${state.slashSelectedIdx}"]`,
    );
    selectedItem?.scrollIntoView({ block: 'nearest' });
  }, [state.slashSelectedIdx, isSlashPopupOpen]);

  // Scroll messages to bottom
  useEffect(() => {
    const container = messagesRef.current;
    if (!container) {
      return;
    }

    container.scrollTop = container.scrollHeight;
  }, [historyBlocks, state.currentTurn]);

  // Close pickers on document click
  useEffect(() => {
    const closePickers = () => {
      dispatch({ type: 'closePickers' });
    };

    document.addEventListener('click', closePickers);
    return () => {
      document.removeEventListener('click', closePickers);
    };
  }, []);

  // Handle pending cursor position
  useEffect(() => {
    if (pendingCursorPositionRef.current === null) {
      return;
    }

    const nextCursorPosition = pendingCursorPositionRef.current;
    pendingCursorPositionRef.current = null;
    requestAnimationFrame(() => {
      const input = promptInputRef.current;
      if (!input || document.activeElement !== input) {
        return;
      }
      setEditableCursorPosition(input, nextCursorPosition);
    });
  }, [state.promptText, cursorPosition]);

  // Reset slash popup state when prompt text changes
  useEffect(() => {
    if (!state.promptText.startsWith('/')) {
      if (state.placeholderOverride !== null) {
        dispatch({ type: 'setPlaceholderOverride', placeholder: null });
      }
      if (state.slashPopupSuppressedFor !== null) {
        dispatch({ type: 'suppressSlashPopup', promptText: null });
      }
    }
  }, [state.placeholderOverride, state.promptText, state.slashPopupSuppressedFor]);

  // Adjust slash selected index
  useEffect(() => {
    const maxIndex = Math.max(slashFilteredCommands.length - 1, 0);
    const nextIndex = slashFilteredCommands.length === 0 ? 0 : Math.min(state.slashSelectedIdx, maxIndex);
    if (nextIndex !== state.slashSelectedIdx) {
      dispatch({ type: 'setSlashSelectedIdx', index: nextIndex });
    }
  }, [slashFilteredCommands.length, state.slashSelectedIdx]);

  // Focus prompt input
  const focusPromptInput = useCallback((): void => {
    requestAnimationFrame(() => {
      promptInputRef.current?.focus();
    });
  }, []);

  // Update cursor from input
  const updateCursorFromInput = useCallback((input: HTMLDivElement): void => {
    const newPos = getEditableCursorPosition(input);
    pendingCursorPositionRef.current = newPos;
    setCursorPosition(newPos);
  }, []);

  // Handle prompt input
  const handlePromptInput = useCallback((event: FormEvent<HTMLDivElement>): void => {
    const input = event.currentTarget;
    const nextPromptText = getEditableText(input);
    const nextCursorPosition = getEditableCursorPosition(input);

    pendingCursorPositionRef.current = nextCursorPosition;
    dispatch({ type: 'setPromptText', text: nextPromptText });
    setCursorPosition(nextCursorPosition);

    if (state.slashPopupSuppressedFor && state.slashPopupSuppressedFor !== nextPromptText) {
      dispatch({ type: 'suppressSlashPopup', promptText: null });
    }
    // Filter mentions based on new text
    const filteredMentions = selectedFileMentions.filter((mention: SelectedFileMention) => 
      nextPromptText.includes(mention.token)
    );
    if (filteredMentions.length !== selectedFileMentions.length) {
      setSelectedFileMentions(filteredMentions);
    }
  }, [state.slashPopupSuppressedFor, selectedFileMentions]);

  // Handle file select - wrapper that updates prompt text
  const handleFileSelect = useCallback((result: FileSearchResult | undefined): void => {
    selectFileResult(result);
    if (result && activeFileMention) {
      const next = replaceActiveFileMention(state.promptText, activeFileMention, result.name);
      pendingCursorPositionRef.current = next.cursorPosition;
      dispatch({ type: 'setPromptText', text: next.text });
    }
  }, [activeFileMention, selectFileResult, state.promptText]);

  // Handle send
  const handleSend = useCallback((explicitText?: string): void => {
    const text = (explicitText ?? state.promptText).trim();
    if (!text || state.isProcessing) {
      return;
    }

    dispatch({ type: 'appendUserMessage', text });
    dispatch({ type: 'setPromptText', text: '' });
    dispatch({ type: 'setPlaceholderOverride', placeholder: null });
    dispatch({ type: 'suppressSlashPopup', promptText: null });
    setSelectedFileMentions([]);
    postMessage({ type: 'sendPrompt', text: expandFileMentionsForPrompt(text, selectedFileMentions) });
  }, [selectedFileMentions, state.isProcessing, state.promptText]);

  // Handle cancel
  const handleCancel = useCallback((): void => {
    postMessage({ type: 'cancelTurn' });
  }, []);

  // Handle welcome command
  const handleWelcomeCommand = useCallback((command: string): void => {
    postMessage({ type: 'executeCommand', command });
  }, []);

  // Handle open debug snapshot
  const handleOpenDebugSnapshot = useCallback((): void => {
    const currentState = stateRef.current;
    postMessage({
      type: 'openDebugSnapshot',
      chatState: {
        persisted: currentState.persisted,
        currentTurn: currentState.currentTurn,
        renderedMarkdown: currentState.renderedMarkdown,
        isProcessing: currentState.isProcessing,
        isLoadingSession: currentState.isLoadingSession,
        promptText: currentState.promptText,
      },
    });
  }, []);

  // Handle pipeline plan actions
  const handleApprovePipelinePlan = useCallback((plan: string): void => {
    dispatch({
      type: 'updatePipelinePlanStatus',
      status: 'implementing',
      message: 'Implementation starting...',
    });
    postMessage({ type: 'approvePipelinePlan', plan });
  }, []);

  const handleRejectPipelinePlan = useCallback((): void => {
    dispatch({
      type: 'updatePipelinePlanStatus',
      status: 'rejected',
      message: 'Plan rejected.',
    });
    postMessage({ type: 'rejectPipelinePlan' });
  }, []);

  // Handle resize
  const handleResizeStart = useCallback((event: ReactMouseEvent<HTMLDivElement>): void => {
    event.preventDefault();
    const startY = event.clientY;
    const startHeight = stateRef.current.inputAreaHeight;

    const onMouseMove = (moveEvent: MouseEvent) => {
      const delta = startY - moveEvent.clientY;
      dispatch({ type: 'setInputAreaHeight', height: startHeight + delta });
    };

    const onMouseUp = () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }, []);

  // Handle mode select
  const handleModeSelect = useCallback((mode: ModeOption, event: ReactMouseEvent<HTMLDivElement>): void => {
    event.stopPropagation();
    dispatch({ type: 'closePickers' });
    if (sessionState?.modes?.currentModeId === mode.id) {
      return;
    }
    dispatch({ type: 'updateCurrentMode', modeId: mode.id });
    postMessage({ type: 'setMode', modeId: mode.id });
  }, [sessionState?.modes?.currentModeId]);

  // Handle model select
  const handleModelSelect = useCallback((model: ModelOption, event: ReactMouseEvent<HTMLDivElement>): void => {
    event.stopPropagation();
    dispatch({ type: 'closePickers' });
    if (sessionState?.models?.currentModelId === model.modelId) {
      return;
    }
    dispatch({ type: 'updateCurrentModel', modelId: model.modelId });
    postMessage({ type: 'setModel', modelId: model.modelId });
  }, [sessionState?.models?.currentModelId]);

  // Handle config option select
  const handleConfigOptionSelect = useCallback((
    option: SessionConfigOption,
    value: ConfigOptionValue,
    event: ReactMouseEvent<HTMLDivElement>,
  ): void => {
    event.stopPropagation();
    dispatch({ type: 'closePickers' });
    if (option.currentValue === value.value) {
      return;
    }

    const configOptions = (sessionState?.configOptions ?? []).map((candidate) =>
      candidate.id === option.id
        ? {
            ...candidate,
            currentValue: value.value,
          }
        : candidate,
    );
    dispatch({ type: 'updateConfigOptions', configOptions });
    postMessage({ type: 'setConfigOption', configId: option.id, value: value.value });
  }, [sessionState?.configOptions]);

  // Select slash command
  const selectSlashCommand = useCallback((command: SlashCommand | undefined): void => {
    if (!command) {
      return;
    }

    dispatch({ type: 'suppressSlashPopup', promptText: state.promptText });
    if (command.input) {
      const text = `/${command.name} `;
      pendingCursorPositionRef.current = text.length;
      dispatch({ type: 'setPromptText', text });
      dispatch({
        type: 'setPlaceholderOverride',
        placeholder: command.input.hint || 'Type input...',
      });
      focusPromptInput();
      return;
    }

    dispatch({ type: 'setPromptText', text: `/${command.name}` });
    dispatch({ type: 'setPlaceholderOverride', placeholder: null });
    handleSend(`/${command.name}`);
  }, [focusPromptInput, handleSend, state.promptText]);

  // Handle prompt key down
  const handlePromptKeyDown = useCallback((event: ReactKeyboardEvent<HTMLDivElement>): void => {
    if (isFilePopupOpen) {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setFileSelectedIdx(Math.min(fileSelectedIdx + 1, fileResults.length - 1));
        return;
      }

      if (event.key === 'ArrowUp') {
        event.preventDefault();
        setFileSelectedIdx(Math.max(fileSelectedIdx - 1, 0));
        return;
      }

      if (event.key === 'Tab') {
        event.preventDefault();
        handleFileSelect(fileResults[fileSelectedIdx]);
        return;
      }

      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        handleFileSelect(fileResults[fileSelectedIdx]);
        return;
      }

      if (event.key === 'Escape') {
        event.preventDefault();
        setSuppressedFileMention(fileMentionKey);
        setFileResults([]);
        return;
      }
    }

    if (isSlashPopupOpen) {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        dispatch({
          type: 'setSlashSelectedIdx',
          index: Math.min(state.slashSelectedIdx + 1, slashFilteredCommands.length - 1),
        });
        return;
      }

      if (event.key === 'ArrowUp') {
        event.preventDefault();
        dispatch({
          type: 'setSlashSelectedIdx',
          index: Math.max(state.slashSelectedIdx - 1, 0),
        });
        return;
      }

      if (event.key === 'Tab') {
        event.preventDefault();
        selectSlashCommand(slashFilteredCommands[state.slashSelectedIdx]);
        return;
      }

      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        selectSlashCommand(slashFilteredCommands[state.slashSelectedIdx]);
        return;
      }

      if (event.key === 'Escape') {
        event.preventDefault();
        dispatch({ type: 'suppressSlashPopup', promptText: state.promptText });
        return;
      }
    }

    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      if (state.isProcessing) {
        handleCancel();
      } else {
        handleSend();
      }
    }
  }, [
    fileMentionKey,
    fileResults,
    fileSelectedIdx,
    handleCancel,
    handleSend,
    handleFileSelect,
    isFilePopupOpen,
    isSlashPopupOpen,
    selectSlashCommand,
    slashFilteredCommands,
    state.isProcessing,
    state.promptText,
    state.slashSelectedIdx,
  ]);

  const emptyStateVisible =
    !state.persisted.hasActiveSession &&
    state.persisted.chatHistory.length === 0 &&
    !state.currentTurn &&
    !state.isLoadingSession;
  const contextFamily = sessionState?.contextFamily;
  const contextFamilyLabel = contextFamily
    ? contextFamily.contextLinkedFrom
      ? `Context family · from ${contextFamily.contextLinkedFrom.agentName}`
      : 'Context family'
    : null;

  return (
    <>
      <div className={`session-banner${state.persisted.hasActiveSession ? ' visible' : ''}`}>
        <span className="dot" />
        <div className="info">
          <div className="agent">{sessionState?.title || sessionState?.agentName || 'Agent'}</div>
          <div className="cwd">{sessionState?.cwd || ''}</div>
          {contextFamilyLabel ? <div className="context-family">{contextFamilyLabel}</div> : null}
          {sessionState?.pendingSharedContext ? (
            <div className="pending-shared-context">Next prompt includes shared context</div>
          ) : null}
        </div>
        <span className="status">{state.isProcessing ? <span className="spinner" /> : null}</span>
        <button
          className="banner-debug-btn"
          title="Open debug snapshot"
          type="button"
          onClick={handleOpenDebugSnapshot}
        >
          Debug
        </button>
      </div>

      <div className="messages" id="messages" ref={messagesRef}>
        {emptyStateVisible ? (
          <div className="empty-state" id="emptyState">
            <div className="icon">🤖</div>
            <div className="title">ACP Chat</div>
            <div className="subtitle">Connect to an AI coding agent to start chatting.</div>
            <div className="actions">
              <button
                className="action-btn primary"
                id="welcomeConnectAgent"
                type="button"
                onClick={() => handleWelcomeCommand('acp.connectAgent')}
              >
                🔌 Connect to Agent
              </button>
              <button
                className="action-btn secondary"
                id="welcomeAddAgent"
                type="button"
                onClick={() => handleWelcomeCommand('acp.addAgent')}
              >
                ⚙ Add Agent
              </button>
            </div>
            <div className="hint">
              or press <kbd>Ctrl+Shift+A</kbd> anytime
            </div>
          </div>
        ) : null}

        {historyBlocks.map((block) => {
          if (block.kind === 'message') {
            return (
              <MessageBubble
                item={block.item}
                key={`message-${block.historyIndex}`}
                onMentionClick={(path) => postMessage({ type: 'openFile', path })}
              />
            );
          }

          if (block.kind === 'plan') {
            return <PlanBlock item={block.item} key={`plan-${block.historyIndex}`} />;
          }

          if (block.kind === 'pipelinePlan') {
            return (
              <PipelinePlanBlock
                item={block.item}
                key={`pipeline-plan-${block.historyIndex}`}
                onApprove={handleApprovePipelinePlan}
                onReject={handleRejectPipelinePlan}
              />
            );
          }

          const collapsed = getToolCollapseState(block.key, block.toolCalls.length, state.collapsedTools);
          return (
            <TurnBlock
              assistantText={block.assistant?.item.text}
              collapsed={collapsed}
              key={block.key}
              onToggleTools={() =>
                dispatch({
                  type: 'setCollapsedTools',
                  key: block.key,
                  collapsed: !collapsed,
                })
              }
              thought={
                block.thought
                  ? {
                      text: block.thought.item.text,
                      durationSec: block.thought.item.durationSec,
                      isStreaming: false,
                    }
                  : null
              }
              toolCalls={block.toolCalls}
              turnKey={block.key}
              onMentionClick={(path) => postMessage({ type: 'openFile', path })}
            />
          );
        })}

        {state.currentTurn ? (
          <TurnBlock
            assistantText={state.currentTurn.assistantText.trim().length > 0 ? state.currentTurn.assistantText : undefined}
            planningDraftText={state.currentTurn.planningDraft}
            collapsed={getToolCollapseState('current-turn', state.currentTurn.toolCalls.length, state.collapsedTools)}
            onToggleTools={() =>
              dispatch({
                type: 'setCollapsedTools',
                key: 'current-turn',
                collapsed: !getToolCollapseState('current-turn', state.currentTurn?.toolCalls.length ?? 0, state.collapsedTools),
              })
            }
            thought={
              state.currentTurn.thought
                ? {
                    text: state.currentTurn.thought.text,
                    durationSec: null,
                    isStreaming: state.currentTurn.thought.finishedAt === null,
                    open: state.currentTurn.thought.isOpen,
                    onToggle: (open) => dispatch({ type: 'setCurrentThoughtOpen', isOpen: open }),
                  }
                : null
            }
            toolCalls={state.currentTurn.toolCalls}
            turnKey="current-turn"
            onMentionClick={(path) => postMessage({ type: 'openFile', path })}
          />
        ) : null}
      </div>

      {state.isLoadingSession ? (
        <div className="load-overlay visible" role="status" aria-live="polite">
          <span className="spinner" />
          <span className="label">Loading session...</span>
        </div>
      ) : null}

      <div
        className={`input-area${disabledBySession ? ' disabled' : ''}`}
        id="inputArea"
        style={{ height: state.inputAreaHeight }}
      >
        <div
          className={`slash-popup${isSlashPopupOpen ? ' open' : ''}`}
          id="slashPopup"
          ref={slashPopupRef}
          onClick={(event) => event.stopPropagation()}
        >
          <div className="slash-popup-header">Commands</div>
          {slashFilteredCommands.map((command, index) => (
            <div
              className={`slash-popup-item${index === state.slashSelectedIdx ? ' active' : ''}`}
              data-index={index}
              key={command.name}
              onClick={() => selectSlashCommand(command)}
              onMouseEnter={() => dispatch({ type: 'setSlashSelectedIdx', index })}
            >
              <span className="cmd-name">/{command.name}</span>
              <span className="cmd-desc">{command.description}</span>
            </div>
          ))}
        </div>

        <div
          className={`file-popup${isFilePopupOpen ? ' open' : ''}`}
          id="filePopup"
          ref={filePopupRef}
          onClick={(event) => event.stopPropagation()}
        >
          <div className="slash-popup-header">Files</div>
          {fileResults.map((result, index) => (
            <div
              className={`file-popup-item${index === fileSelectedIdx ? ' active' : ''}`}
              data-index={index}
              key={result.path}
              onClick={() => handleFileSelect(result)}
              onMouseEnter={() => setFileSelectedIdx(index)}
            >
              <span className="file-name">{result.name}</span>
              <span className="file-path">{result.path}</span>
            </div>
          ))}
        </div>

        <div className="input-resize-handle" id="resizeHandle" onMouseDown={handleResizeStart} />

        <div className="input-toolbar">
          {(sessionState?.configOptions ?? []).filter((option) =>
            option.type === 'select' && (option.options ?? []).length > 0
          ).map((option) => (
            <div className="picker-wrap" key={option.id} onClick={(event) => event.stopPropagation()}>
              <button
                className="picker-btn"
                title={option.description || option.name || ''}
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  dispatch({ type: 'toggleConfigDropdown', configId: option.id });
                }}
              >
                <span className="picker-icon">⚙</span>
                <span className="picker-label">{option.name}</span>
                <span className="picker-chevron">▾</span>
              </button>
            </div>
          ))}

          {!sessionState?.configOptions?.some(opt => opt.type === 'select' && (opt.options ?? []).length > 0) && sessionState?.modes?.availableModes.length ? (
            <div className="picker-wrap" onClick={(event) => event.stopPropagation()}>
              <button
                className="picker-btn"
                title={currentMode?.description ?? 'Select mode'}
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  dispatch({ type: 'toggleModeDropdown' });
                }}
              >
                <span className="picker-icon">⚡</span>
                <span className="picker-label">{currentMode?.name ?? 'Mode'}</span>
                <span className="picker-chevron">▾</span>
              </button>
            </div>
          ) : (
            <div className="picker-wrap hidden" />
          )}

          {!sessionState?.configOptions?.some(opt => opt.type === 'select' && (opt.options ?? []).length > 0) && sessionState?.models?.availableModels.length ? (
            <div className="picker-wrap" onClick={(event) => event.stopPropagation()}>
              <button
                className="picker-btn"
                title={currentModel?.description ?? 'Select model'}
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  dispatch({ type: 'toggleModelDropdown' });
                }}
              >
                <span className="picker-icon">🧠</span>
                <span className="picker-label">{currentModel?.name ?? 'Model'}</span>
                <span className="picker-chevron">▾</span>
              </button>
            </div>
          ) : (
            <div className="picker-wrap hidden" />
          )}
          <span className="toolbar-spacer" />
        </div>

        <div className="input-editor-wrap">
          <MarkdownEditor
            ref={promptInputRef}
            value={state.promptText}
            onChange={(text) => {
              dispatch({ type: 'setPromptText', text });
              const nextCursorPosition = text.length;
              pendingCursorPositionRef.current = nextCursorPosition;
              setCursorPosition(nextCursorPosition);

              if (state.slashPopupSuppressedFor && state.slashPopupSuppressedFor !== text) {
                dispatch({ type: 'suppressSlashPopup', promptText: null });
              }

              const filteredMentions = selectedFileMentions.filter((mention) =>
                text.includes(mention.token)
              );
              if (filteredMentions.length !== selectedFileMentions.length) {
                setSelectedFileMentions(filteredMentions);
              }
            }}
            placeholder={placeholder}
            disabled={disabledBySession || state.isProcessing}
            onKeyDown={handlePromptKeyDown}
            onFocus={focusPromptInput}
            fileMentions={selectedFileMentions.map(m => ({ token: m.token, path: m.path, name: m.name }))}
            onMentionClick={(path) => postMessage({ type: 'openFile', path })}
          />
        </div>

        <div className="input-send-row">
          <button
            className={`send-stop-btn ${state.isProcessing ? 'stop' : 'send'}`}
            disabled={!state.isProcessing && (disabledBySession || state.promptText.trim().length === 0)}
            id="sendStopBtn"
            type="button"
            onClick={() => {
              if (state.isProcessing) {
                handleCancel();
              } else {
                handleSend();
              }
            }}
          >
            {state.isProcessing ? '■ Stop' : 'Send'}
          </button>
        </div>
      </div>
    </>
  );
}

function getEditableText(input: HTMLDivElement): string {
  return input.textContent ?? '';
}

function getEditableCursorPosition(input: HTMLDivElement): number {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) {
    return getEditableText(input).length;
  }

  const range = selection.getRangeAt(0);
  if (!input.contains(range.endContainer)) {
    return getEditableText(input).length;
  }

  const preCaretRange = range.cloneRange();
  preCaretRange.selectNodeContents(input);
  preCaretRange.setEnd(range.endContainer, range.endOffset);
  return preCaretRange.toString().length;
}

function setEditableCursorPosition(input: HTMLDivElement, cursorPosition: number): void {
  const targetPosition = Math.max(0, Math.min(cursorPosition, getEditableText(input).length));
  const walker = document.createTreeWalker(input, NodeFilter.SHOW_TEXT);
  let remaining = targetPosition;
  let node = walker.nextNode();

  while (node) {
    const textLength = node.textContent?.length ?? 0;
    if (remaining <= textLength) {
      const range = document.createRange();
      const selection = window.getSelection();
      range.setStart(node, remaining);
      range.collapse(true);
      selection?.removeAllRanges();
      selection?.addRange(range);
      return;
    }
    remaining -= textLength;
    node = walker.nextNode();
  }

  const range = document.createRange();
  const selection = window.getSelection();
  range.selectNodeContents(input);
  range.collapse(false);
  selection?.removeAllRanges();
  selection?.addRange(range);
}

// Local normalization functions (not in normalizers.ts)
function normalizePipelineStatus(status: unknown): PipelinePlanStatus | null {
  switch (status) {
    case 'awaiting_approval':
      return 'pending';
    case 'implementing':
    case 'completed':
    case 'rejected':
    case 'error':
    case 'cancelled':
      return status;
    default:
      return null;
  }
}

function normalizePipelinePhase(phase: unknown): PipelinePhase | undefined {
  return phase === 'planner' || phase === 'implementer' ? phase : undefined;
}
