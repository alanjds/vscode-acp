import type {
  JSX,
  FormEvent,
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
  RefObject,
} from 'react';
import { memo, useMemo } from 'react';

import { Picker } from './Picker';
import type { AppAction, AppState } from '../app/state';
import type {
  ConfigOptionGroup,
  ConfigOptionValue,
  FileSearchResult,
  ModelOption,
  ModeOption,
  SelectedFileMention,
  SessionConfigOption,
  SessionSnapshot,
  SlashCommand,
} from '../chatTypes';

interface InputAreaProps {
  state: AppState;
  disabledBySession: boolean;
  slashFilteredCommands: SlashCommand[];
  isSlashPopupOpen: boolean;
  slashPopupRef: RefObject<HTMLDivElement | null>;
  selectSlashCommand: (command?: SlashCommand) => void;
  dispatch: (action: AppAction) => void;
  handleResizeStart: (e: ReactMouseEvent<HTMLDivElement>) => void;
  sessionState?: SessionSnapshot | null;
  currentMode?: ModeOption;
  currentModel?: ModelOption;
  handleModeSelect: (mode: ModeOption, e: ReactMouseEvent<HTMLDivElement>) => void;
  handleModelSelect: (model: ModelOption, e: ReactMouseEvent<HTMLDivElement>) => void;
  handleConfigOptionSelect: (
    option: SessionConfigOption,
    value: ConfigOptionValue,
    e: ReactMouseEvent<HTMLDivElement>,
  ) => void;
  promptInputRef: RefObject<HTMLDivElement | null>;
  handlePromptKeyDown: (e: ReactKeyboardEvent<HTMLDivElement>) => void;
  placeholder?: string | null;
  handleCancel: () => void;
  handleSend: (explicitText?: string) => void;
  fileResults: FileSearchResult[];
  fileSelectedIdx: number;
  filePopupRef: RefObject<HTMLDivElement | null>;
  isFilePopupOpen: boolean;
  onFileSelect: (result?: FileSearchResult) => void;
  onFileHover: (index: number) => void;
  onPromptInput: (event: FormEvent<HTMLDivElement>) => void;
  onPromptSelect: (input: HTMLDivElement) => void;
  selectedFileMentions: SelectedFileMention[];
  onOpenSelectedFile: (path: string) => void;
  sendLabel?: string;
}

function InputArea({
  state,
  disabledBySession,
  slashFilteredCommands,
  isSlashPopupOpen,
  slashPopupRef,
  selectSlashCommand,
  dispatch,
  handleResizeStart,
  sessionState,
  currentMode,
  currentModel,
  handleModeSelect,
  handleModelSelect,
  handleConfigOptionSelect,
  promptInputRef,
  handlePromptKeyDown,
  placeholder,
  handleCancel,
  handleSend,
  fileResults,
  fileSelectedIdx,
  filePopupRef,
  isFilePopupOpen,
  onFileSelect,
  onFileHover,
  onPromptInput,
  onPromptSelect,
  selectedFileMentions,
  onOpenSelectedFile,
  sendLabel = 'Send',
}: InputAreaProps): JSX.Element {
  const configOptions = useMemo(
    () => (sessionState?.configOptions ?? []).filter(hasSelectableValues),
    [sessionState?.configOptions],
  );
  const useConfigOptions = configOptions.length > 0;

  return (
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
            onClick={() => onFileSelect(result)}
            onMouseEnter={() => onFileHover(index)}
          >
            <span className="file-name">{result.name}</span>
            <span className="file-path">{result.path}</span>
          </div>
        ))}
      </div>

      <div className="input-resize-handle" id="resizeHandle" onMouseDown={handleResizeStart} />

      <div className="input-toolbar">
        {configOptions.map((option) => (
          <ConfigOptionPicker
            dispatch={dispatch}
            isOpen={state.openConfigDropdownId === option.id}
            key={option.id}
            onSelect={handleConfigOptionSelect}
            option={option}
          />
        ))}

        {!useConfigOptions && sessionState?.modes?.availableModes.length ? (
          <Picker
            currentValue={sessionState.modes.currentModeId ?? null}
            icon="⚡"
            isOpen={state.isModeDropdownOpen}
            itemDescription={(mode) => mode.description}
            itemKey={(mode) => mode.id}
            itemLabel={(mode) => mode.name}
            items={sessionState.modes.availableModes}
            label={currentMode?.name ?? 'Mode'}
            onSelect={handleModeSelect}
            onToggle={(event) => {
              event.stopPropagation();
              dispatch({ type: 'toggleModeDropdown' });
            }}
            title={currentMode?.description ?? 'Select mode'}
          />
        ) : (
          <div className="picker-wrap hidden" />
        )}

        {!useConfigOptions && sessionState?.models?.availableModels.length ? (
          <Picker
            currentValue={sessionState.models.currentModelId ?? null}
            icon="🧠"
            isOpen={state.isModelDropdownOpen}
            itemDescription={(model) => model.description}
            itemKey={(model) => model.modelId}
            itemLabel={(model) => model.name}
            items={sessionState.models.availableModels}
            label={currentModel?.name ?? 'Model'}
            onSelect={handleModelSelect}
            onToggle={(event) => {
              event.stopPropagation();
              dispatch({ type: 'toggleModelDropdown' });
            }}
            title={currentModel?.description ?? 'Select model'}
          />
        ) : (
          <div className="picker-wrap hidden" />
        )}
        <span className="toolbar-spacer" />
      </div>

      <div className="input-editor-wrap">
        <div
          aria-multiline="true"
          className="prompt-input"
          contentEditable={!disabledBySession && !state.isProcessing}
          data-placeholder={placeholder ?? ''}
          id="promptInput"
          onInput={onPromptInput}
          onClick={(event) => onPromptSelect(event.currentTarget)}
          onKeyDown={handlePromptKeyDown}
          onKeyUp={(event) => onPromptSelect(event.currentTarget)}
          onMouseUp={(event) => onPromptSelect(event.currentTarget)}
          ref={promptInputRef}
          role="textbox"
          suppressContentEditableWarning
          tabIndex={disabledBySession || state.isProcessing ? -1 : 0}
        >
          {renderPromptWithFileLinks(state.promptText, selectedFileMentions, onOpenSelectedFile)}
        </div>
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
          {state.isProcessing ? '■ Stop' : sendLabel}
        </button>
      </div>
    </div>
  );
}

export default memo(InputArea);

function renderPromptWithFileLinks(
  text: string,
  mentions: SelectedFileMention[],
  onOpenSelectedFile: (path: string) => void,
): React.ReactNode {
  if (mentions.length === 0) {
    return text;
  }

  const orderedMentions = [...mentions].sort((a, b) => b.token.length - a.token.length);
  const parts: React.ReactNode[] = [];
  let index = 0;

  while (index < text.length) {
    const mention = orderedMentions.find((candidate) => text.startsWith(candidate.token, index));
    if (!mention) {
      const nextMentionIndex = orderedMentions.reduce((nextIndex, candidate) => {
        const candidateIndex = text.indexOf(candidate.token, index + 1);
        if (candidateIndex < 0) {
          return nextIndex;
        }
        return nextIndex < 0 ? candidateIndex : Math.min(nextIndex, candidateIndex);
      }, -1);
      const end = nextMentionIndex < 0 ? text.length : nextMentionIndex;
      if (end > index) {
        parts.push(text.slice(index, end));
      }
      index = end;
      continue;
    }

    parts.push(
      <span
        className="prompt-inline-file-link"
        contentEditable={false}
        key={`file-${index}-${mention.path}`}
        onClick={(event) => {
          event.stopPropagation();
          onOpenSelectedFile(mention.path);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            event.stopPropagation();
            onOpenSelectedFile(mention.path);
          }
        }}
        onMouseDown={(event) => {
          event.preventDefault();
          event.stopPropagation();
          onOpenSelectedFile(mention.path);
        }}
      >
        {mention.token}
      </span>,
    );
    index += mention.token.length;
  }

  return parts;
}

function hasSelectableValues(option: SessionConfigOption): boolean {
  return option.type === 'select' && flattenConfigValues(option).length > 0;
}

function isConfigGroup(value: ConfigOptionValue | ConfigOptionGroup): value is ConfigOptionGroup {
  return Array.isArray((value as ConfigOptionGroup).options);
}

function flattenConfigValues(option: SessionConfigOption): ConfigOptionValue[] {
  return (option.options ?? []).flatMap((entry) => {
    if (isConfigGroup(entry)) {
      return entry.options;
    }
    return [entry];
  });
}

function configIconForCategory(category?: string): string {
  switch (category) {
    case 'mode':
      return '⚡';
    case 'model':
      return '🧠';
    case 'thought_level':
      return '💭';
    default:
      return '⚙';
  }
}

function getSelectedConfigValue(option: SessionConfigOption): ConfigOptionValue | undefined {
  return flattenConfigValues(option).find((value) => value.value === option.currentValue);
}

const ConfigOptionPicker = memo(function ConfigOptionPicker({
  dispatch,
  isOpen,
  onSelect,
  option,
}: {
  dispatch: (action: AppAction) => void;
  isOpen: boolean;
  onSelect: (
    option: SessionConfigOption,
    value: ConfigOptionValue,
    e: ReactMouseEvent<HTMLDivElement>,
  ) => void;
  option: SessionConfigOption;
}): JSX.Element {
  const selectedValue = useMemo(() => getSelectedConfigValue(option), [option]);
  const label = selectedValue?.name ?? option.name ?? 'Option';
  const title = selectedValue?.description ?? option.description ?? option.name ?? '';

  return (
    <div className="picker-wrap" onClick={(event) => event.stopPropagation()}>
      <button
        className="picker-btn"
        title={title}
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          dispatch({ type: 'toggleConfigDropdown', configId: option.id });
        }}
      >
        <span className="picker-icon">{configIconForCategory(option.category)}</span>
        <span className="picker-label">{label}</span>
        <span className="picker-chevron">▾</span>
      </button>
      <div className={`picker-dropdown${isOpen ? ' open' : ''}`}>
        {(option.options ?? []).map((entry) => {
          if (isConfigGroup(entry)) {
            return (
              <div className="picker-dropdown-group" key={entry.group ?? entry.name ?? JSON.stringify(entry.options)}>
                <div className="picker-dropdown-group-header">{entry.name ?? entry.group ?? ''}</div>
                {entry.options.map((value) => (
                  <ConfigOptionItem
                    key={`${option.id}-${value.value}`}
                    onSelect={onSelect}
                    option={option}
                    value={value}
                  />
                ))}
              </div>
            );
          }

          return (
            <ConfigOptionItem
              key={`${option.id}-${entry.value}`}
              onSelect={onSelect}
              option={option}
              value={entry}
            />
          );
        })}
      </div>
    </div>
  );
});

function ConfigOptionItem({
  onSelect,
  option,
  value,
}: {
  onSelect: (
    option: SessionConfigOption,
    value: ConfigOptionValue,
    e: ReactMouseEvent<HTMLDivElement>,
  ) => void;
  option: SessionConfigOption;
  value: ConfigOptionValue;
}): JSX.Element {
  const selected = value.value === option.currentValue;
  return (
    <div
      className={`picker-dropdown-item${selected ? ' selected' : ''}`}
      onClick={(event) => onSelect(option, value, event)}
      title={value.description}
    >
      <span className="check">{selected ? '✓' : ''}</span>
      <span className="item-label">{value.name ?? value.value}</span>
      {value.description ? <span className="item-desc">{value.description}</span> : null}
    </div>
  );
}
