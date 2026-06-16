import { useMemo } from 'react';
import type { ModelOption, ModeOption, PersistedWebviewState, SlashCommand } from '../chatTypes';
import { getSlashFilteredCommands } from './composer';

type SessionState = PersistedWebviewState['sessionState'];

interface UseSessionDisplayProps {
  sessionState: SessionState | null;
  availableCommands: SlashCommand[];
  promptText: string;
  placeholderOverride: string | null;
  slashPopupSuppressedFor: string | null;
}

interface UseSessionDisplayReturn {
  slashFilteredCommands: SlashCommand[];
  currentMode: ModeOption | undefined;
  currentModel: ModelOption | undefined;
  placeholder: string;
  isSlashPopupOpen: boolean;
}

function getBasePlaceholder(commands: readonly SlashCommand[]): string {
  return commands.length > 0
    ? 'Type a message, @ for files, or / for commands...'
    : 'Type a message or @ for files...';
}

/**
 * Custom hook for computing session-related display values.
 * Extracts the various useMemo selectors from App.tsx.
 */
export function useSessionDisplay({
  sessionState,
  availableCommands,
  promptText,
  placeholderOverride,
  slashPopupSuppressedFor,
}: UseSessionDisplayProps): UseSessionDisplayReturn {
  const slashFilteredCommands = useMemo(
    () => getSlashFilteredCommands(promptText, availableCommands),
    [availableCommands, promptText],
  );

  const currentMode = useMemo(
    () => sessionState?.modes?.availableModes.find((mode) => mode.id === sessionState.modes?.currentModeId),
    [sessionState?.modes?.availableModes, sessionState?.modes?.currentModeId],
  );

  const currentModel = useMemo(
    () => sessionState?.models?.availableModels.find((model) => model.modelId === sessionState.models?.currentModelId),
    [sessionState?.models?.availableModels, sessionState?.models?.currentModelId],
  );

  const basePlaceholder = useMemo(
    () => getBasePlaceholder(availableCommands),
    [availableCommands],
  );

  const placeholder = useMemo(() => {
    if (promptText.startsWith('/') && placeholderOverride) {
      return placeholderOverride;
    }
    return basePlaceholder;
  }, [basePlaceholder, placeholderOverride, promptText]);

  const isSlashPopupOpen = useMemo(() =>
    slashFilteredCommands.length > 0 &&
    slashPopupSuppressedFor !== promptText,
    [slashFilteredCommands.length, slashPopupSuppressedFor, promptText],
  );

  return {
    slashFilteredCommands,
    currentMode,
    currentModel,
    placeholder,
    isSlashPopupOpen,
  };
}
