import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  type Dispatch,
  type JSX,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type RefObject,
} from 'react';

import type {
  ConfigOptionValue,
  FileSearchResult,
  ModelOption,
  ModeOption,
  SessionConfigOption,
  SessionSnapshot,
  SlashCommand,
} from '../chatTypes';
import type { AppAction } from '../app/state';
import { MarkdownEditor, setMarkdownEditableCursorPosition } from './MarkdownEditor';
import { Picker } from './Picker';
import { Codicon } from './Codicon';

export type ChatComposerProps = {
  promptText: string;
  inputAreaHeight: number;
  slashSelectedIdx: number;
  openConfigDropdownId: string | null;
  isModeDropdownOpen: boolean;
  isModelDropdownOpen: boolean;
  slashPopupSuppressedFor: string | null;
  isProcessing: boolean;
  dispatch: Dispatch<AppAction>;
  sessionState: SessionSnapshot | null;
  currentMode: ModeOption | undefined;
  currentModel: ModelOption | undefined;
  placeholder: string;
  disabledBySession: boolean;
  isSlashPopupOpen: boolean;
  slashFilteredCommands: SlashCommand[];
  isFilePopupOpen: boolean;
  fileResults: FileSearchResult[];
  fileSelectedIdx: number;
  selectedFileMentions: Array<{ token: string; path: string; name: string }>;
  onResizeStart: (event: ReactMouseEvent<HTMLDivElement>) => void;
  onModeSelect: (mode: ModeOption, event: ReactMouseEvent<HTMLDivElement>) => void;
  onModelSelect: (model: ModelOption, event: ReactMouseEvent<HTMLDivElement>) => void;
  onConfigOptionSelect: (
    option: SessionConfigOption,
    value: ConfigOptionValue,
    event: ReactMouseEvent<HTMLDivElement>,
  ) => void;
  onSelectSlashCommand: (command: SlashCommand | undefined) => void;
  onFileSelect: (result: FileSearchResult | undefined) => void;
  onFileSelectedIdxChange: (index: number) => void;
  onPromptKeyDown: (event: ReactKeyboardEvent<HTMLDivElement>) => void;
  onFocusPrompt: () => void;
  onSend: () => void;
  onCancel: () => void;
  onMentionClick: (path: string) => void;
  onSelectedFileMentionsChange: (
    mentions: Array<{ token: string; path: string; name: string }>,
  ) => void;
  pendingCursorPositionRef: React.MutableRefObject<number | null>;
  promptInputRef: RefObject<HTMLDivElement | null>;
  setCursorPosition: (position: number) => void;
};

function ChatComposerComponent({
  promptText,
  inputAreaHeight,
  slashSelectedIdx,
  openConfigDropdownId,
  isModeDropdownOpen,
  isModelDropdownOpen,
  slashPopupSuppressedFor,
  isProcessing,
  dispatch,
  sessionState,
  currentMode,
  currentModel,
  placeholder,
  disabledBySession,
  isSlashPopupOpen,
  slashFilteredCommands,
  isFilePopupOpen,
  fileResults,
  fileSelectedIdx,
  selectedFileMentions,
  onResizeStart,
  onModeSelect,
  onModelSelect,
  onConfigOptionSelect,
  onSelectSlashCommand,
  onFileSelect,
  onFileSelectedIdxChange,
  onPromptKeyDown,
  onFocusPrompt,
  onSend,
  onCancel,
  onMentionClick,
  onSelectedFileMentionsChange,
  pendingCursorPositionRef,
  promptInputRef,
  setCursorPosition,
}: ChatComposerProps): JSX.Element {
  const slashPopupRef = useRef<HTMLDivElement | null>(null);
  const filePopupRef = useRef<HTMLDivElement | null>(null);

  const configOptions = (sessionState?.configOptions ?? []).filter(
    (option) => option.type === 'select' && (option.options ?? []).length > 0,
  );
  const hasConfigPickers = configOptions.length > 0;
  const showModePicker = !hasConfigPickers && (sessionState?.modes?.availableModes.length ?? 0) > 0;
  const showModelPicker = !hasConfigPickers && (sessionState?.models?.availableModels.length ?? 0) > 0;

  const editorFileMentions = useMemo(
    () =>
      selectedFileMentions.map((mention) => ({
        token: mention.token,
        path: mention.path,
        name: mention.name,
      })),
    [selectedFileMentions],
  );

  const handlePromptChange = useCallback(
    (text: string, nextCursorPosition = text.length) => {
      dispatch({ type: 'setPromptText', text });
      pendingCursorPositionRef.current = nextCursorPosition;
      setCursorPosition(nextCursorPosition);

      if (slashPopupSuppressedFor && slashPopupSuppressedFor !== text) {
        dispatch({ type: 'suppressSlashPopup', promptText: null });
      }

      const filteredMentions = selectedFileMentions.filter((mention) =>
        text.includes(mention.token),
      );
      if (filteredMentions.length !== selectedFileMentions.length) {
        onSelectedFileMentionsChange(filteredMentions);
      }
    },
    [
      dispatch,
      onSelectedFileMentionsChange,
      pendingCursorPositionRef,
      selectedFileMentions,
      setCursorPosition,
      slashPopupSuppressedFor,
    ],
  );

  const handleSendStopClick = useCallback(() => {
    if (isProcessing) {
      onCancel();
    } else {
      onSend();
    }
  }, [isProcessing, onCancel, onSend]);

  useEffect(() => {
    const selectedItem = filePopupRef.current?.querySelector<HTMLElement>(
      `.file-popup-item[data-index="${fileSelectedIdx}"]`,
    );
    selectedItem?.scrollIntoView({ block: 'nearest' });
  }, [fileSelectedIdx, isFilePopupOpen]);

  useEffect(() => {
    const selectedItem = slashPopupRef.current?.querySelector<HTMLElement>(
      `.slash-popup-item[data-index="${slashSelectedIdx}"]`,
    );
    selectedItem?.scrollIntoView({ block: 'nearest' });
  }, [isSlashPopupOpen, slashSelectedIdx]);

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
      setMarkdownEditableCursorPosition(input, nextCursorPosition);
    });
  }, [promptText]);

  return (
    <div
      className={`input-area${disabledBySession ? ' disabled' : ''}`}
      id="inputArea"
      style={{ height: inputAreaHeight }}
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
            className={`slash-popup-item${index === slashSelectedIdx ? ' active' : ''}`}
            data-index={index}
            key={command.name}
            onClick={() => onSelectSlashCommand(command)}
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
            onClick={() => onFileSelect(result)}
            onMouseEnter={() => onFileSelectedIdxChange(index)}
          >
            <span className="file-name">{result.name}</span>
            <span className="file-path">{result.path}</span>
          </div>
        ))}
      </div>

      <div className="input-resize-handle" id="resizeHandle" onMouseDown={onResizeStart} />

      <div className="input-toolbar">
        {configOptions.map((option) => {
          const configItems = (option.options ?? []).filter(
            (item): item is ConfigOptionValue => 'value' in item,
          );
          return (
            <Picker
              key={option.id}
              currentValue={option.currentValue ?? null}
              icon="gear"
              isOpen={openConfigDropdownId === option.id}
              itemDescription={(value) => value.description}
              itemKey={(value) => value.value}
              itemLabel={(value) => value.name ?? value.value}
              items={configItems}
              label={option.name ?? 'Config'}
              title={option.description || option.name || ''}
              onSelect={(value, event) => onConfigOptionSelect(option, value, event)}
              onToggle={(event) => {
                event.stopPropagation();
                dispatch({ type: 'toggleConfigDropdown', configId: option.id });
              }}
            />
          );
        })}

        {showModePicker ? (
          <Picker
            currentValue={sessionState?.modes?.currentModeId ?? null}
            icon="symbol-event"
            isOpen={isModeDropdownOpen}
            itemDescription={(mode) => mode.description}
            itemKey={(mode) => mode.id}
            itemLabel={(mode) => mode.name}
            items={sessionState?.modes?.availableModes ?? []}
            label={currentMode?.name ?? 'Mode'}
            title={currentMode?.description ?? 'Select mode'}
            onSelect={onModeSelect}
            onToggle={(event) => {
              event.stopPropagation();
              dispatch({ type: 'toggleModeDropdown' });
            }}
          />
        ) : (
          <div className="picker-wrap hidden" />
        )}

        {showModelPicker ? (
          <Picker
            currentValue={sessionState?.models?.currentModelId ?? null}
            icon="hubot"
            isOpen={isModelDropdownOpen}
            itemDescription={(model) => model.description}
            itemKey={(model) => model.modelId}
            itemLabel={(model) => model.name}
            items={sessionState?.models?.availableModels ?? []}
            label={currentModel?.name ?? 'Model'}
            title={currentModel?.description ?? 'Select model'}
            onSelect={onModelSelect}
            onToggle={(event) => {
              event.stopPropagation();
              dispatch({ type: 'toggleModelDropdown' });
            }}
          />
        ) : (
          <div className="picker-wrap hidden" />
        )}
        <span className="toolbar-spacer" />
      </div>

      <div className="input-editor-wrap">
        <MarkdownEditor
          ref={promptInputRef}
          value={promptText}
          onChange={handlePromptChange}
          placeholder={placeholder}
          disabled={disabledBySession || isProcessing}
          onKeyDown={onPromptKeyDown}
          onFocus={onFocusPrompt}
          fileMentions={editorFileMentions}
          onMentionClick={onMentionClick}
        />
      </div>

      <div className="input-send-row">
        <button
          className={`send-stop-btn ${isProcessing ? 'stop' : 'send'}`}
          disabled={!isProcessing && (disabledBySession || promptText.trim().length === 0)}
          id="sendStopBtn"
          type="button"
          onClick={handleSendStopClick}
        >
          {isProcessing ? (
            <>
              <Codicon name="debug-stop" />
              Stop
            </>
          ) : (
            <>
              <Codicon name="send" />
              Send
            </>
          )}
        </button>
      </div>
    </div>
  );
}

export const ChatComposer = memo(ChatComposerComponent);
