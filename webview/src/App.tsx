import {
  useEffect,
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
import InputArea from './components/InputArea';
import { PlanBlock } from './components/PlanBlock';
import { PipelinePlanBlock } from './components/PipelinePlanBlock';
import { TurnBlock } from './components/TurnBlock';
import { getState, onMessage, postMessage, setState } from './vscode';

export function App(): JSX.Element {
  const [state, dispatch] = useReducer(appReducer, getState<PersistedWebviewState>(), createInitialState);
  const [cursorPosition, setCursorPosition] = useState(0);
  const [fileResults, setFileResults] = useState<FileSearchResult[]>([]);
  const [fileSelectedIdx, setFileSelectedIdx] = useState(0);
  const [suppressedFileMention, setSuppressedFileMention] = useState<string | null>(null);
  const [selectedFileMentions, setSelectedFileMentions] = useState<SelectedFileMention[]>([]);
  const stateRef = useRef(state);
  const restoreMarkdownItemsRef = useRef(getRestoreMarkdownItems(state.persisted.chatHistory));
  const turnCounterRef = useRef(0);
  const loadMarkdownRequestedRef = useRef(false);
  const messagesRef = useRef<HTMLDivElement | null>(null);
  const promptInputRef = useRef<HTMLDivElement | null>(null);
  const slashPopupRef = useRef<HTMLDivElement | null>(null);
  const filePopupRef = useRef<HTMLDivElement | null>(null);
  const fileSearchRequestIdRef = useRef(0);
  const pendingCursorPositionRef = useRef<number | null>(null);

  stateRef.current = state;

  const sessionState = state.persisted.sessionState;
  const availableCommands = sessionState?.availableCommands ?? [];
  const basePlaceholder = getBasePlaceholder(availableCommands);
  const slashFilteredCommands = getSlashFilteredCommands(state.promptText, availableCommands);
  const activeFileMention = getActiveFileMention(state.promptText, cursorPosition);
  const fileMentionKey = activeFileMention
    ? `${activeFileMention.start}:${activeFileMention.end}:${activeFileMention.query}:${cursorPosition}`
    : null;
  const fileSearchKey = activeFileMention
    ? `${activeFileMention.start}:${activeFileMention.end}:${activeFileMention.query}`
    : null;
  const isSlashPopupOpen =
    slashFilteredCommands.length > 0 &&
    state.slashPopupSuppressedFor !== state.promptText;
  const isFilePopupOpen =
    Boolean(activeFileMention) &&
    suppressedFileMention !== fileMentionKey &&
    fileResults.length > 0;
  const placeholder =
    state.promptText.startsWith('/') && state.placeholderOverride
      ? state.placeholderOverride
      : basePlaceholder;
  const disabledBySession =
    state.isLoadingSession || (!state.persisted.hasActiveSession && !state.composerUnlocked);
  const excludedToolIndexes = new Set(state.currentTurn?.historyToolCallIndexes ?? []);
  const historyBlocks = buildHistoryBlocks(state.persisted.chatHistory, excludedToolIndexes);
  const currentMode = sessionState?.modes?.availableModes.find(
    (mode) => mode.id === sessionState.modes?.currentModeId,
  );
  const currentModel = sessionState?.models?.availableModels.find(
    (model) => model.modelId === sessionState.models?.currentModelId,
  );

  useEffect(() => {
    setState(state.persisted);
  }, [state.persisted]);

  useEffect(() => {
    if (!loadMarkdownRequestedRef.current || state.isLoadingSession) {
      return;
    }

    const items = getRestoreMarkdownItems(state.persisted.chatHistory);
    if (items.length > 0) {
      postMessage({ type: 'renderMarkdown', items });
    }
    loadMarkdownRequestedRef.current = false;
  }, [state.isLoadingSession, state.persisted.chatHistory]);

  useEffect(() => {
    if (restoreMarkdownItemsRef.current.length > 0) {
      postMessage({ type: 'renderMarkdown', items: restoreMarkdownItemsRef.current });
      restoreMarkdownItemsRef.current = [];
    }

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
          const markdownItem = getPromptEndMarkdownItem(stateRef.current);
          dispatch({ type: 'promptEnd' });
          if (markdownItem) {
            postMessage({ type: 'renderMarkdown', items: [markdownItem] });
          }
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
          for (const action of mapSessionUpdateToActions(normalizeSessionUpdate(message.update))) {
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

        case 'markdownRendered':
          dispatch({
            type: 'setRenderedMarkdown',
            items: normalizeMarkdownRenderedItems(message.items),
          });
          break;
      }
    });
  }, []);

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

  useEffect(() => {
    const maxIndex = Math.max(slashFilteredCommands.length - 1, 0);
    const nextIndex = slashFilteredCommands.length === 0 ? 0 : Math.min(state.slashSelectedIdx, maxIndex);
    if (nextIndex !== state.slashSelectedIdx) {
      dispatch({ type: 'setSlashSelectedIdx', index: nextIndex });
    }
  }, [slashFilteredCommands.length, state.slashSelectedIdx]);

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
  }, [fileSearchKey]);

  useEffect(() => {
    const selectedItem = slashPopupRef.current?.querySelector<HTMLElement>(
      `.slash-popup-item[data-index="${state.slashSelectedIdx}"]`,
    );
    selectedItem?.scrollIntoView({ block: 'nearest' });
  }, [state.slashSelectedIdx, isSlashPopupOpen]);

  useEffect(() => {
    const selectedItem = filePopupRef.current?.querySelector<HTMLElement>(
      `.file-popup-item[data-index="${fileSelectedIdx}"]`,
    );
    selectedItem?.scrollIntoView({ block: 'nearest' });
  }, [fileSelectedIdx, isFilePopupOpen]);

  useEffect(() => {
    const container = messagesRef.current;
    if (!container) {
      return;
    }

    container.scrollTop = container.scrollHeight;
  }, [historyBlocks, state.currentTurn, state.renderedMarkdown]);

  useEffect(() => {
    const closePickers = () => {
      dispatch({ type: 'closePickers' });
    };

    document.addEventListener('click', closePickers);
    return () => {
      document.removeEventListener('click', closePickers);
    };
  }, []);

  function focusPromptInput(): void {
    requestAnimationFrame(() => {
      promptInputRef.current?.focus();
    });
  }

  function updateCursorFromInput(input: HTMLDivElement): void {
    const newPos = getEditableCursorPosition(input);
    pendingCursorPositionRef.current = newPos;
    setCursorPosition(newPos);
  }

  function handlePromptInput(event: FormEvent<HTMLDivElement>): void {
    const input = event.currentTarget;
    const nextPromptText = getEditableText(input);
    const nextCursorPosition = getEditableCursorPosition(input);

    pendingCursorPositionRef.current = nextCursorPosition;
    dispatch({ type: 'setPromptText', text: nextPromptText });
    setCursorPosition(nextCursorPosition);

    if (state.slashPopupSuppressedFor && state.slashPopupSuppressedFor !== nextPromptText) {
      dispatch({ type: 'suppressSlashPopup', promptText: null });
    }
    setSelectedFileMentions((prevMentions) => {
      const nextMentions = prevMentions.filter((mention) => nextPromptText.includes(mention.token));
      return nextMentions.length === prevMentions.length ? prevMentions : nextMentions;
    });
  }

  function selectFileResult(result: FileSearchResult | undefined, mention: ActiveFileMention | null = activeFileMention): void {
    if (!result || !mention) {
      return;
    }

    const next = replaceActiveFileMention(stateRef.current.promptText, mention, result.name);
    const token = `@${result.name}`;
    const nextSuppressedKey = `${mention.start}:${mention.start + token.length}:${result.name}:${mention.start + token.length}`;
    pendingCursorPositionRef.current = next.cursorPosition;
    fileSearchRequestIdRef.current += 1;
    setSuppressedFileMention(nextSuppressedKey);
    setFileResults([]);
    setFileSelectedIdx(0);
    setSelectedFileMentions((mentions) => [
      ...mentions.filter((candidate) => candidate.token !== token),
      { ...result, token },
    ]);
    dispatch({ type: 'setPromptText', text: next.text });
  }

  function handleSend(explicitText?: string): void {
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
  }

  function handleOpenSelectedFile(path: string): void {
    postMessage({ type: 'openFile', path });
  }

  function handleCancel(): void {
    postMessage({ type: 'cancelTurn' });
  }

  function handleWelcomeCommand(command: string): void {
    postMessage({ type: 'executeCommand', command });
  }

  function handleApprovePipelinePlan(plan: string): void {
    dispatch({
      type: 'updatePipelinePlanStatus',
      status: 'implementing',
      message: 'Implementation starting...',
    });
    postMessage({ type: 'approvePipelinePlan', plan });
  }

  function handleRejectPipelinePlan(): void {
    dispatch({
      type: 'updatePipelinePlanStatus',
      status: 'rejected',
      message: 'Plan rejected.',
    });
    postMessage({ type: 'rejectPipelinePlan' });
  }

  function handleResizeStart(event: ReactMouseEvent<HTMLDivElement>): void {
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
  }

  function selectSlashCommand(command: SlashCommand | undefined): void {
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
  }

  function handlePromptKeyDown(event: ReactKeyboardEvent<HTMLDivElement>): void {
    if (isFilePopupOpen) {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setFileSelectedIdx(index => Math.min(index + 1, fileResults.length - 1));
        return;
      }

      if (event.key === 'ArrowUp') {
        event.preventDefault();
        setFileSelectedIdx(index => Math.max(index - 1, 0));
        return;
      }

      if (event.key === 'Tab') {
        event.preventDefault();
        selectFileResult(fileResults[fileSelectedIdx]);
        return;
      }

      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        selectFileResult(fileResults[fileSelectedIdx]);
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
  }

  function handleModeSelect(mode: ModeOption, event: ReactMouseEvent<HTMLDivElement>): void {
    event.stopPropagation();
    dispatch({ type: 'closePickers' });
    if (sessionState?.modes?.currentModeId === mode.id) {
      return;
    }
    dispatch({ type: 'updateCurrentMode', modeId: mode.id });
    postMessage({ type: 'setMode', modeId: mode.id });
  }

  function handleModelSelect(model: ModelOption, event: ReactMouseEvent<HTMLDivElement>): void {
    event.stopPropagation();
    dispatch({ type: 'closePickers' });
    if (sessionState?.models?.currentModelId === model.modelId) {
      return;
    }
    dispatch({ type: 'updateCurrentModel', modelId: model.modelId });
    postMessage({ type: 'setModel', modelId: model.modelId });
  }

  function handleConfigOptionSelect(
    option: SessionConfigOption,
    value: ConfigOptionValue,
    event: ReactMouseEvent<HTMLDivElement>,
  ): void {
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
  }

  const emptyStateVisible =
    !state.persisted.hasActiveSession &&
    state.persisted.chatHistory.length === 0 &&
    !state.currentTurn &&
    !state.isLoadingSession;

  return (
    <>
      <div className={`session-banner${state.persisted.hasActiveSession ? ' visible' : ''}`}>
        <span className="dot" />
        <div className="info">
          <div className="agent">{sessionState?.title || sessionState?.agentName || 'Agent'}</div>
          <div className="cwd">{sessionState?.cwd || ''}</div>
        </div>
        <span className="status">{state.isProcessing ? <span className="spinner" /> : null}</span>
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
                renderedHtml={state.renderedMarkdown[block.historyIndex]}
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

          const assistantHtml = block.assistant
            ? state.renderedMarkdown[block.assistant.historyIndex]
            : undefined;
          const collapsed = getToolCollapseState(block.key, block.toolCalls.length, state.collapsedTools);
          return (
            <TurnBlock
              assistantHtml={assistantHtml}
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
            />
          );
        })}

        {state.currentTurn ? (
          <TurnBlock
            assistantText={state.currentTurn.assistantText.trim().length > 0 ? state.currentTurn.assistantText : undefined}
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
          />
        ) : null}
      </div>

      {state.isLoadingSession ? (
        <div className="load-overlay visible" role="status" aria-live="polite">
          <span className="spinner" />
          <span className="label">Loading session...</span>
        </div>
      ) : null}

      <InputArea
        state={state}
        disabledBySession={disabledBySession}
        slashFilteredCommands={slashFilteredCommands}
        isSlashPopupOpen={isSlashPopupOpen}
        slashPopupRef={slashPopupRef}
        selectSlashCommand={selectSlashCommand}
        dispatch={dispatch}
        handleResizeStart={handleResizeStart}
        sessionState={sessionState}
        currentMode={currentMode}
        currentModel={currentModel}
        handleModeSelect={handleModeSelect}
        handleModelSelect={handleModelSelect}
        handleConfigOptionSelect={handleConfigOptionSelect}
        promptInputRef={promptInputRef}
        handlePromptKeyDown={handlePromptKeyDown}
        placeholder={placeholder}
        handleCancel={handleCancel}
        handleSend={handleSend}
        fileResults={fileResults}
        fileSelectedIdx={fileSelectedIdx}
        filePopupRef={filePopupRef}
        isFilePopupOpen={isFilePopupOpen}
        onFileSelect={selectFileResult}
        onFileHover={setFileSelectedIdx}
        onPromptInput={handlePromptInput}
        onPromptSelect={updateCursorFromInput}
        selectedFileMentions={selectedFileMentions}
        onOpenSelectedFile={handleOpenSelectedFile}
      />
    </>
  );
}

function getEditableText(input: HTMLDivElement): string {
  return input.textContent ?? '';
}

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
