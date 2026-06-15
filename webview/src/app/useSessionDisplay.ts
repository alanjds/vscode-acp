import { useMemo } from 'react';
import type { PersistedWebviewState } from '../chatTypes';
import { getBasePlaceholder, getSlashFilteredCommands } from './composer';

type SessionState = PersistedWebviewState['sessionState'];

interface UseSessionDisplayProps {
  sessionState: SessionState | null;
  availableCommands: any[];
  promptText: string;
  placeholderOverride: string | null;
  slashPopupSuppressedFor: string | null;
}

interface UseSessionDisplayReturn {
  basePlaceholder: string;
  slashFilteredCommands: any[];
  currentMode: any | undefined;
  currentModel: any | undefined;
  placeholder: string;
  isSlashPopupOpen: boolean;
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
  const basePlaceholder = useMemo(
    () => getBasePlaceholder(availableCommands),
    [availableCommands],
  );

  const slashFilteredCommands = useMemo(
    () => getSlashFilteredCommands(promptText, availableCommands),
    [availableCommands, promptText],
  );

  const currentMode = useMemo(
    () => sessionState?.modes?.availableModes.find((mode: any) => mode.id === sessionState.modes?.currentModeId),
    [sessionState?.modes?.availableModes, sessionState?.modes?.currentModeId],
  );

  const currentModel = useMemo(
    () => sessionState?.models?.availableModels.find((model: any) => model.modelId === sessionState.models?.currentModelId),
    [sessionState?.models?.availableModels, sessionState?.models?.currentModelId],
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
    basePlaceholder,
    slashFilteredCommands,
    currentMode,
    currentModel,
    placeholder,
    isSlashPopupOpen,
  };
}
