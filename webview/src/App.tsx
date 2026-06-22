import {
  useEffect,
  useCallback,
  useMemo,
  useReducer,
  useRef,
  useState,
  type JSX,
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
  ChatWebviewSharedState,
  SessionConfigOption,
  SlashCommand,
} from './chatTypes';
import {
  expandFileMentionsForPrompt,
  getSlashFilteredCommands,
} from './app/composer';
import { buildHistoryBlocks, getRestoreMarkdownItems, getToolCollapseState } from './app/history';
import {
  normalizeConfigOptions,
  normalizeModelsState,
  normalizeModesState,
  normalizeSessionSnapshot,
  normalizeSessionUpdate,
} from './app/normalizers';
import { mapSessionUpdateToActions } from './app/sessionUpdates';
import { appReducer, buildSharedSnapshot, createInitialState } from './app/state';
import { MessageBubble } from './components/MessageBubble';
import { ChatComposer } from './components/ChatComposer';
import { CurrentTurnBlock } from './components/CurrentTurnBlock';
import { EmptyState } from './components/EmptyState';
import { HistoryTurnBlock } from './components/HistoryTurnBlock';
import { SessionBanner } from './components/SessionBanner';
import { PlanBlock } from './components/PlanBlock';
import { PipelinePlanBlock } from './components/PipelinePlanBlock';
import {
  applyPipelineStatusToTimeline,
  createDefaultTeamTimeline,
  PipelineRoleTimeline,
} from './components/PipelineRoleTimeline';
import { PipelineRoleOutputBlock } from './components/PipelineRoleOutputBlock';
import { getState, onMessage, postMessage, setState } from './vscode';
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
  const pendingCursorPositionRef = useRef<number | null>(null);
  const sharedVersionRef = useRef(0);
  const sharedUpdatedAtRef = useRef(0);
  const skipSharedSyncRef = useRef(false);

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
  const hasPendingPipelinePlan = useMemo(
    () => state.persisted.chatHistory.some(
      item => item.kind === 'pipelinePlan' && item.status === 'pending',
    ),
    [state.persisted.chatHistory],
  );
  const composerPlaceholder = hasPendingPipelinePlan
    ? 'Send a message to revise the plan, or approve/reject below.'
    : placeholder;

  // Sync shared UI state to extension host and VS Code serializer
  useEffect(() => {
    if (skipSharedSyncRef.current) {
      skipSharedSyncRef.current = false;
      return;
    }

    sharedVersionRef.current += 1;
    sharedUpdatedAtRef.current = Date.now();
    const snapshot = buildSharedSnapshot(
      state,
      sharedVersionRef.current,
      sharedUpdatedAtRef.current,
    );
    setState(snapshot);
    postMessage({ type: 'sharedStateChanged', state: snapshot });
  }, [
    state.persisted,
    state.promptText,
    state.inputAreaHeight,
    state.isProcessing,
    state.currentTurn,
    state.collapsedTools,
    state.pipelineTimeline,
    state.activePipelineRole,
    state.activePipelineAgentName,
    state.composerUnlocked,
  ]);

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
        case 'hydrateSharedState':
        case 'sharedStateUpdated':
          if (message.state && typeof message.state === 'object') {
            const sharedState = message.state as ChatWebviewSharedState;
            const isStale =
              sharedState.version < sharedVersionRef.current
              || (sharedState.version === sharedVersionRef.current
                && sharedState.updatedAt <= sharedUpdatedAtRef.current);
            if (isStale) {
              break;
            }
            sharedVersionRef.current = sharedState.version;
            sharedUpdatedAtRef.current = sharedState.updatedAt;
            skipSharedSyncRef.current = true;
            dispatch({ type: 'hydrateSharedState', state: sharedState });
          }
          break;

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
            const planAction = message.revised === true
              ? {
                  type: 'revisePipelinePlan' as const,
                  plan: message.plan,
                  role: normalizePipelinePhase(message.role),
                  agentName: typeof message.agentName === 'string' ? message.agentName : undefined,
                  implementerUsesSandcastle: message.implementerUsesSandcastle === true,
                }
              : {
                  type: 'appendPipelinePlan' as const,
                  plan: message.plan,
                  role: normalizePipelinePhase(message.role),
                  agentName: typeof message.agentName === 'string' ? message.agentName : undefined,
                  implementerUsesSandcastle: message.implementerUsesSandcastle === true,
                };
            dispatch(planAction);
            if (typeof message.teamId === 'string' && message.revised !== true) {
              dispatch({
                type: 'updatePipelineTimeline',
                timeline: createDefaultTeamTimeline(false),
              });
            }
          }
          break;

        case 'pipelinePlanApprovalFailed':
          dispatch({ type: 'revertPipelinePlanApproval' });
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
          if (typeof message.teamId === 'string') {
            dispatch({
              type: 'updatePipelineTimeline',
              timeline: applyPipelineStatusToTimeline(
                stateRef.current.pipelineTimeline.length > 0
                  ? stateRef.current.pipelineTimeline
                  : createDefaultTeamTimeline(false),
                typeof message.status === 'string' ? message.status : undefined,
                typeof message.stepId === 'string' ? message.stepId : undefined,
              ),
            });
          }
          const role = normalizePipelinePhase(message.role);
          if (role) {
            dispatch({
              type: 'setActivePipelineRole',
              role,
              agentName: typeof message.agentName === 'string' ? message.agentName : null,
            });
          }
          break;
        }

        case 'reviewerRerunReady':
          if (typeof message.output === 'string') {
            dispatch({
              type: 'appendPipelineRoleOutput',
              role: 'reviewer-rerun',
              text: message.output,
              title: 'Review (rerun)',
            });
          }
          break;

        case 'sessionUpdate':
          for (const action of mapSessionUpdateToActions(
            normalizeSessionUpdate(message.update),
            normalizePipelinePhase(message.phase ?? message.role),
          )) {
            dispatch(action);
          }
          if (message.role || message.agentName) {
            dispatch({
              type: 'setActivePipelineRole',
              role: normalizePipelinePhase(message.role ?? message.phase) ?? null,
              agentName: typeof message.agentName === 'string' ? message.agentName : null,
            });
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

  // Scroll messages to bottom when near bottom or history changes
  useEffect(() => {
    const container = messagesRef.current;
    if (!container) {
      return;
    }

    const isNearBottom =
      container.scrollHeight - container.scrollTop - container.clientHeight < 80;

    if (!isNearBottom && state.currentTurn) {
      return;
    }

    requestAnimationFrame(() => {
      const node = messagesRef.current;
      if (node) {
        node.scrollTop = node.scrollHeight;
      }
    });
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

  // Handle file select - wrapper that updates prompt text
  const handleFileSelect = useCallback((result: FileSearchResult | undefined): void => {
    const next = selectFileResult(result);
    if (next) {
      pendingCursorPositionRef.current = next.cursorPosition;
      dispatch({ type: 'setPromptText', text: next.text });
      setCursorPosition(next.cursorPosition);
    }
  }, [selectFileResult]);

  // Handle send
  const handleSend = useCallback((explicitText?: string): void => {
    const text = (explicitText ?? state.promptText).trim();
    if (!text || state.isProcessing) {
      return;
    }

    dispatch({ type: 'submitUserMessage', text });
    setSelectedFileMentions([]);
    setCursorPosition(0);
    pendingCursorPositionRef.current = 0;
    focusPromptInput();
    postMessage({
      type: 'sendPrompt',
      text,
      agentText: expandFileMentionsForPrompt(text, selectedFileMentions),
    });
  }, [focusPromptInput, selectedFileMentions, state.isProcessing, state.promptText]);

  // Handle cancel
  const handleCancel = useCallback((): void => {
    postMessage({ type: 'cancelTurn' });
  }, []);

  // Handle welcome command
  const handleWelcomeCommand = useCallback((command: string): void => {
    postMessage({ type: 'executeCommand', command });
  }, []);

  const handleConnectAgent = useCallback((): void => {
    handleWelcomeCommand('acp.connectAgent');
  }, [handleWelcomeCommand]);

  const handleAddAgent = useCallback((): void => {
    handleWelcomeCommand('acp.addAgent');
  }, [handleWelcomeCommand]);

  const handleMentionClick = useCallback((path: string): void => {
    postMessage({ type: 'openFile', path });
  }, []);

  const handleToggleCollapsedTools = useCallback((key: string, collapsed: boolean): void => {
    dispatch({ type: 'setCollapsedTools', key, collapsed: !collapsed });
  }, []);

  const handleCurrentThoughtOpen = useCallback((open: boolean): void => {
    dispatch({ type: 'setCurrentThoughtOpen', isOpen: open });
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

  return (
    <>
      <SessionBanner
        isProcessing={state.isProcessing}
        onOpenDebugSnapshot={handleOpenDebugSnapshot}
        sessionState={sessionState}
        visible={state.persisted.hasActiveSession}
      />

      <div className="messages" id="messages" ref={messagesRef}>
        {emptyStateVisible ? (
          <EmptyState onAddAgent={handleAddAgent} onConnectAgent={handleConnectAgent} />
        ) : null}

        {state.pipelineTimeline.length > 0 ? (
          <PipelineRoleTimeline timeline={state.pipelineTimeline} />
        ) : null}

        {historyBlocks.map((block) => {
          if (block.kind === 'message') {
            return (
              <MessageBubble
                item={block.item}
                key={`message-${block.historyIndex}`}
                onMentionClick={handleMentionClick}
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

          if (block.kind === 'pipelineRoleOutput') {
            return (
              <PipelineRoleOutputBlock
                item={block.item}
                key={`pipeline-role-${block.historyIndex}`}
              />
            );
          }

          const collapsed = getToolCollapseState(block.key, block.toolCalls.length, state.collapsedTools);
          return (
            <HistoryTurnBlock
              block={block}
              collapsed={collapsed}
              key={block.key}
              onMentionClick={handleMentionClick}
              onToggleCollapsedTools={handleToggleCollapsedTools}
            />
          );
        })}

        {state.currentTurn ? (
          <CurrentTurnBlock
            collapsed={getToolCollapseState(
              'current-turn',
              state.currentTurn.toolCalls.length,
              state.collapsedTools,
            )}
            currentTurn={state.currentTurn}
            onMentionClick={handleMentionClick}
            onThoughtOpenChange={handleCurrentThoughtOpen}
            onToggleCollapsedTools={handleToggleCollapsedTools}
          />
        ) : null}
      </div>

      {state.isLoadingSession ? (
        <div className="load-overlay visible" role="status" aria-live="polite">
          <span className="spinner" />
          <span className="label">Loading session...</span>
        </div>
      ) : null}

      <ChatComposer
        currentMode={currentMode}
        currentModel={currentModel}
        disabledBySession={disabledBySession}
        dispatch={dispatch}
        fileResults={fileResults}
        fileSelectedIdx={fileSelectedIdx}
        inputAreaHeight={state.inputAreaHeight}
        isFilePopupOpen={isFilePopupOpen}
        isModeDropdownOpen={state.isModeDropdownOpen}
        isModelDropdownOpen={state.isModelDropdownOpen}
        isProcessing={state.isProcessing}
        isSlashPopupOpen={isSlashPopupOpen}
        onCancel={handleCancel}
        onConfigOptionSelect={handleConfigOptionSelect}
        onFileSelect={handleFileSelect}
        onFileSelectedIdxChange={setFileSelectedIdx}
        onFocusPrompt={focusPromptInput}
        onMentionClick={handleMentionClick}
        onModeSelect={handleModeSelect}
        onModelSelect={handleModelSelect}
        onPromptKeyDown={handlePromptKeyDown}
        onResizeStart={handleResizeStart}
        onSelectSlashCommand={selectSlashCommand}
        onSelectedFileMentionsChange={setSelectedFileMentions}
        onSend={handleSend}
        openConfigDropdownId={state.openConfigDropdownId}
        pendingCursorPositionRef={pendingCursorPositionRef}
        placeholder={composerPlaceholder}
        promptInputRef={promptInputRef}
        promptText={state.promptText}
        selectedFileMentions={selectedFileMentions}
        sessionState={sessionState}
        setCursorPosition={setCursorPosition}
        slashFilteredCommands={slashFilteredCommands}
        slashPopupSuppressedFor={state.slashPopupSuppressedFor}
        slashSelectedIdx={state.slashSelectedIdx}
      />
    </>
  );
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
  return phase === 'planner'
    || phase === 'implementer'
    || phase === 'reviewer'
    || phase === 'tester'
    || phase === 'reviewer-rerun'
    ? phase
    : undefined;
}
