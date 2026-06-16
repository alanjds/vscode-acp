import {
  useState,
  useMemo,
  useCallback,
  useRef,
  type Dispatch,
  type SetStateAction,
  type MutableRefObject,
} from 'react';
import type { FileSearchResult, SelectedFileMention } from '../chatTypes';
import {
  createFileMentionToken,
  getActiveFileMention,
  replaceActiveFileMention,
  type ActiveFileMention,
} from './composer';

interface UseFileMentionsProps {
  promptText: string;
  cursorPosition: number;
}

interface UseFileMentionsReturn {
  activeFileMention: ActiveFileMention | null;
  fileMentionKey: string | null;
  fileSearchKey: string | null;
  fileResults: FileSearchResult[];
  fileSelectedIdx: number;
  suppressedFileMention: string | null;
  selectedFileMentions: SelectedFileMention[];
  isFilePopupOpen: boolean;
  fileSearchRequestIdRef: MutableRefObject<number>;
  setFileResults: (results: FileSearchResult[]) => void;
  setFileSelectedIdx: (index: number) => void;
  setSuppressedFileMention: (key: string | null) => void;
  setSelectedFileMentions: Dispatch<SetStateAction<SelectedFileMention[]>>;
  selectFileResult: (
    result: FileSearchResult | undefined,
    mention?: ActiveFileMention | null,
  ) => { text: string; cursorPosition: number } | null;
}

/**
 * Custom hook for managing file mention logic in the chat input.
 * Handles detection of @file mentions, file search, and selection.
 * Now uses Markdown link format [@filename](file://path) for file mentions.
 */
export function useFileMentions({ promptText, cursorPosition }: UseFileMentionsProps): UseFileMentionsReturn {
  const [fileResults, setFileResults] = useState<FileSearchResult[]>([]);
  const [fileSelectedIdx, setFileSelectedIdx] = useState(0);
  const [suppressedFileMention, setSuppressedFileMention] = useState<string | null>(null);
  const [selectedFileMentions, setSelectedFileMentions] = useState<SelectedFileMention[]>([]);
  const fileSearchRequestIdRef = useRef(0);

  const activeFileMention = useMemo(
    () => getActiveFileMention(promptText, cursorPosition),
    [cursorPosition, promptText],
  );

  const fileMentionKey = useMemo(() =>
    activeFileMention
      ? `${activeFileMention.start}:${activeFileMention.end}:${activeFileMention.query}:${cursorPosition}`
      : null,
    [activeFileMention, cursorPosition],
  );

  const fileSearchKey = useMemo(() =>
    activeFileMention
      ? `${activeFileMention.start}:${activeFileMention.end}:${activeFileMention.query}`
      : null,
    [activeFileMention],
  );

  const isFilePopupOpen = useMemo(() =>
    Boolean(activeFileMention) &&
    suppressedFileMention !== fileMentionKey &&
    fileResults.length > 0,
    [activeFileMention, suppressedFileMention, fileMentionKey, fileResults.length],
  );

  const selectFileResult = useCallback((
    result: FileSearchResult | undefined,
    mention: ActiveFileMention | null = null,
  ): { text: string; cursorPosition: number } | null => {
    const activeMention = mention || activeFileMention;
    if (!result || !activeMention) {
      return null;
    }

    const replacement = replaceActiveFileMention(
      promptText,
      activeMention,
      result.name,
      result.path,
    );

    const token = createFileMentionToken(result.name, result.path);
    const nextSuppressedKey = `${activeMention.start}:${activeMention.start + token.length}:${result.name}:${activeMention.start + token.length}`;
    fileSearchRequestIdRef.current += 1;
    setSuppressedFileMention(nextSuppressedKey);
    setFileResults([]);
    setFileSelectedIdx(0);
    
    // Update selected mentions with the new token format
    setSelectedFileMentions((prevMentions) => [
      ...prevMentions.filter((candidate) => candidate.token !== token),
      { ...result, token },
    ]);

    return replacement;
  }, [activeFileMention, promptText]);

  return {
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
  };
}
