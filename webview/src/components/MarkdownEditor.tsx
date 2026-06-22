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

import { findAllMarkdownFileMentions } from '../app/composer';

export type MarkdownEditorProps = {
  value: string;
  onChange: (value: string, cursorPosition?: number) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  onKeyDown?: (e: ReactKeyboardEvent<HTMLDivElement>) => void;
  onFocus?: () => void;
  fileMentions?: Array<{ token: string; path: string; name: string }>;
  onMentionClick?: (path: string) => void;
};

type RenderedMention = {
  token: string;
  path: string;
  name: string;
  start: number;
  end: number;
};

function isMentionElement(node: Node): node is HTMLElement {
  return node instanceof HTMLElement && node.classList.contains('prompt-file-mention');
}

function getNodeToken(node: Node): string | null {
  return isMentionElement(node) ? node.dataset.token ?? null : null;
}

function serializeNode(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) {
    return node.textContent ?? '';
  }

  if (node.nodeName === 'BR') {
    return '\n';
  }

  const token = getNodeToken(node);
  if (token !== null) {
    return token;
  }

  return Array.from(node.childNodes).map(serializeNode).join('');
}

function getMarkdownEditableText(input: HTMLElement): string {
  return Array.from(input.childNodes).map(serializeNode).join('');
}

function getRenderedMentions(value: string, fileMentions: MarkdownEditorProps['fileMentions']): RenderedMention[] {
  const byToken = new Map((fileMentions ?? []).map(mention => [mention.token, mention]));
  const matches = findAllMarkdownFileMentions(value)
    .map((match) => {
      const selectedMention = byToken.get(match.fullMatch);
      return {
        token: match.fullMatch,
        path: selectedMention?.path ?? match.filePath,
        name: selectedMention?.name ?? match.displayName,
        start: match.start,
        end: match.end,
      };
    })
    .sort((a, b) => a.start - b.start || b.end - a.end);

  const nonOverlapping: RenderedMention[] = [];
  let consumedUntil = -1;
  for (const match of matches) {
    if (match.start < consumedUntil) {
      continue;
    }
    nonOverlapping.push(match);
    consumedUntil = match.end;
  }

  return nonOverlapping;
}

function createMentionElement(mention: RenderedMention): HTMLSpanElement {
  const chip = document.createElement('span');
  chip.className = 'prompt-file-mention';
  chip.contentEditable = 'false';
  chip.dataset.token = mention.token;
  chip.dataset.filePath = mention.path;
  chip.dataset.fileName = mention.name;
  chip.title = `Click to open ${mention.path}`;
  chip.textContent = mention.name;
  return chip;
}

function renderMarkdownEditableContent(input: HTMLElement, value: string, fileMentions: MarkdownEditorProps['fileMentions']): void {
  if (!value) {
    input.replaceChildren();
    return;
  }

  const renderedMentions = getRenderedMentions(value, fileMentions);
  if (renderedMentions.length === 0) {
    input.replaceChildren(document.createTextNode(value));
    return;
  }

  const nodes: Node[] = [];
  let cursor = 0;

  for (const mention of renderedMentions) {
    if (mention.start > cursor) {
      nodes.push(document.createTextNode(value.slice(cursor, mention.start)));
    }

    nodes.push(createMentionElement(mention));
    cursor = mention.end;
  }

  if (cursor < value.length) {
    nodes.push(document.createTextNode(value.slice(cursor)));
  }

  input.replaceChildren(...nodes);
}

function getSerializedLengthBeforePosition(node: Node, target: Node, offset: number): { length: number; found: boolean } {
  if (node === target) {
    if (node.nodeType === Node.TEXT_NODE) {
      return { length: (node.textContent ?? '').slice(0, offset).length, found: true };
    }

    let length = 0;
    for (let index = 0; index < Math.min(offset, node.childNodes.length); index += 1) {
      length += serializeNode(node.childNodes[index]).length;
    }
    return { length, found: true };
  }

  const token = getNodeToken(node);
  if (token !== null) {
    return { length: token.length, found: false };
  }

  let length = 0;
  for (const child of Array.from(node.childNodes)) {
    const result = getSerializedLengthBeforePosition(child, target, offset);
    if (result.found) {
      return { length: length + result.length, found: true };
    }
    length += result.length;
  }

  return { length, found: false };
}

function getMarkdownEditableCursorPosition(input: HTMLElement): number {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) {
    return getMarkdownEditableText(input).length;
  }

  const range = selection.getRangeAt(0);
  if (!input.contains(range.endContainer)) {
    return getMarkdownEditableText(input).length;
  }

  return getSerializedLengthBeforePosition(input, range.endContainer, range.endOffset).length;
}

function setRangeAtTextNode(node: Node, offset: number): void {
  const range = document.createRange();
  const selection = window.getSelection();
  range.setStart(node, offset);
  range.collapse(true);
  selection?.removeAllRanges();
  selection?.addRange(range);
}

function setRangeAroundElement(element: HTMLElement, after: boolean): void {
  const range = document.createRange();
  const selection = window.getSelection();
  if (after) {
    range.setStartAfter(element);
  } else {
    range.setStartBefore(element);
  }
  range.collapse(true);
  selection?.removeAllRanges();
  selection?.addRange(range);
}

function placeCursorWithinNode(node: Node, remaining: number): boolean {
  if (node.nodeType === Node.TEXT_NODE) {
    const textLength = node.textContent?.length ?? 0;
    if (remaining <= textLength) {
      setRangeAtTextNode(node, remaining);
      return true;
    }
    return false;
  }

  if (node.nodeName === 'BR') {
    return remaining <= 1;
  }

  const token = getNodeToken(node);
  if (token !== null) {
    if (remaining <= token.length) {
      setRangeAroundElement(node as HTMLElement, remaining > 0);
      return true;
    }
    return false;
  }

  let cursor = remaining;
  for (const child of Array.from(node.childNodes)) {
    const childText = serializeNode(child);
    if (cursor <= childText.length) {
      return placeCursorWithinNode(child, cursor);
    }
    cursor -= childText.length;
  }

  return false;
}

export function setMarkdownEditableCursorPosition(input: HTMLElement, cursorPosition: number): void {
  const targetPosition = Math.max(0, Math.min(cursorPosition, getMarkdownEditableText(input).length));
  if (placeCursorWithinNode(input, targetPosition)) {
    return;
  }

  const range = document.createRange();
  const selection = window.getSelection();
  range.selectNodeContents(input);
  range.collapse(false);
  selection?.removeAllRanges();
  selection?.addRange(range);
}

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

    const domText = getMarkdownEditableText(editor);
    if (domText === value && value !== '') {
      return;
    }

    suppressInputRef.current = true;
    renderMarkdownEditableContent(editor, value, fileMentions);
    queueMicrotask(() => {
      suppressInputRef.current = false;
    });
  }, [fileMentions, value]);

  // Gérer les clics sur les mentions de fichiers
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

  // Gérer la position du curseur
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
