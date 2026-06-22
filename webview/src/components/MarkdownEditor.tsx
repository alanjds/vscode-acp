import {
  useCallback,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  forwardRef,
  memo,
  type ForwardedRef,
  type KeyboardEvent as ReactKeyboardEvent,
  type FormEvent,
  type MouseEvent as ReactMouseEvent,
} from 'react';

import {
  getMarkdownEditableCursorPosition,
  getMarkdownEditableText,
  needsMarkdownEditableResync,
  renderMarkdownEditableContent,
  type MarkdownFileMention,
} from './markdownEditableDom';

export { setMarkdownEditableCursorPosition } from './markdownEditableDom';

export type MarkdownEditorProps = {
  value: string;
  onChange: (value: string, cursorPosition?: number) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  onKeyDown?: (e: ReactKeyboardEvent<HTMLDivElement>) => void;
  onFocus?: () => void;
  fileMentions?: MarkdownFileMention[];
  onMentionClick?: (path: string) => void;
};

const MarkdownEditorComponent = (
  {
    value,
    onChange,
    placeholder = "Type your message here...",
    disabled = false,
    className = "",
    onKeyDown,
    onFocus,
    fileMentions = [],
    onMentionClick,
  }: MarkdownEditorProps,
  ref: ForwardedRef<HTMLDivElement>
) => {
  const editorRef = useRef<HTMLDivElement>(null);
  const suppressInputRef = useRef(false);

  useImperativeHandle(ref, () => editorRef.current as HTMLDivElement);

  useLayoutEffect(() => {
    const editor = editorRef.current;
    if (!editor) {
      return;
    }

    if (!needsMarkdownEditableResync(editor, value)) {
      return;
    }

    suppressInputRef.current = true;
    renderMarkdownEditableContent(editor, value, fileMentions);
    queueMicrotask(() => {
      suppressInputRef.current = false;
    });
  }, [fileMentions, value]);

  const handleClick = useCallback(
    (e: ReactMouseEvent<HTMLDivElement>) => {
      const target = e.target as HTMLElement;
      const mentionChip = target.closest('.prompt-file-mention');
      if (mentionChip) {
        e.preventDefault();
        e.stopPropagation();
        const filePath = mentionChip.getAttribute('data-file-path');
        if (filePath && onMentionClick) {
          onMentionClick(filePath);
        }
        return;
      }
      onFocus?.();
    },
    [onFocus, onMentionClick]
  );

  const handleInput = useCallback(
    (e: FormEvent<HTMLDivElement>) => {
      if (suppressInputRef.current) {
        return;
      }
      const text = getMarkdownEditableText(e.currentTarget);
      onChange(text, getMarkdownEditableCursorPosition(e.currentTarget));
    },
    [onChange]
  );

  return (
    <div
      aria-multiline="true"
      className={`prompt-input ${className}`}
      contentEditable={!disabled}
      suppressContentEditableWarning
      ref={editorRef}
      onInput={handleInput}
      onClick={handleClick}
      onKeyDown={onKeyDown}
      onFocus={onFocus}
      role="textbox"
      tabIndex={disabled ? -1 : 0}
      data-placeholder={placeholder}
    />
  );
};

const MarkdownEditorWithRef = forwardRef<HTMLDivElement, MarkdownEditorProps>(MarkdownEditorComponent);

export const MarkdownEditor = memo(MarkdownEditorWithRef);
