import React, { useState, useCallback, memo, useRef, forwardRef, ForwardedRef } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

export type MarkdownEditorProps = {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  onKeyDown?: (e: React.KeyboardEvent<HTMLDivElement>) => void;
  onFocus?: () => void;
  fileMentions?: Array<{ token: string; path: string; name: string }>;
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
  const [cursorPosition, setCursorPosition] = useState(0);
  
  // Forward the ref
  React.useImperativeHandle(ref, () => editorRef.current as HTMLDivElement);

  // Rendu du markdown avec mentions de fichiers en chips
  const getRenderedContent = useCallback(() => {
    if (fileMentions.length === 0) {
      return value || placeholder;
    }

    let content = value;
    const mentionsSorted = [...fileMentions].sort((a, b) => b.token.length - a.token.length);

    for (const mention of mentionsSorted) {
      const chip = ` @${mention.name} `;
      content = content.replace(new RegExp(mention.token, 'g'), chip);
    }

    return content || placeholder;
  }, [value, fileMentions, placeholder]);

  // Gérer les clics sur les mentions de fichiers
  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
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
    (e: React.FormEvent<HTMLDivElement>) => {
      const text = e.currentTarget.textContent || '';
      onChange(text);
    },
    [onChange]
  );

  const handleKeyUp = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      const selection = window.getSelection();
      if (selection && selection.rangeCount > 0) {
        const range = selection.getRangeAt(0);
        if (editorRef.current && editorRef.current.contains(range.startContainer)) {
          const preCaretRange = range.cloneRange();
          preCaretRange.selectNodeContents(editorRef.current);
          preCaretRange.setEnd(range.startContainer, range.startOffset);
          setCursorPosition(preCaretRange.toString().length);
        }
      }
    },
    []
  );

  // Rendre le contenu avec les mentions en chips
  const renderContent = useCallback(() => {
    if (fileMentions.length === 0) {
      return value || <span style={{ color: '#999' }}>{placeholder}</span>;
    }

    let parts: React.ReactNode[] = [];
    let remainingText = value || '';
    const mentionsSorted = [...fileMentions].sort((a, b) => b.token.length - a.token.length);

    for (const mention of mentionsSorted) {
      const index = remainingText.indexOf(mention.token);
      if (index === -1) continue;

      // Ajouter le texte avant la mention
      if (index > 0) {
        parts.push(remainingText.substring(0, index));
      }

      // Ajouter la mention comme chip
      parts.push(
        <span
          key={mention.token}
          className="prompt-file-mention"
          data-file-path={mention.path}
          data-file-name={mention.name}
          title={`Click to open ${mention.path}`}
          style={{
            backgroundColor: '#e0f2fe',
            color: '#0369a1',
            padding: '2px 6px',
            borderRadius: '4px',
            margin: '0 2px',
            cursor: 'pointer',
            fontFamily: 'monospace',
          }}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onMentionClick?.(mention.path);
          }}
        >
          @{mention.name}
        </span>
      );

      remainingText = remainingText.substring(index + mention.token.length);
    }

    // Ajouter le texte restant
    if (remainingText) {
      parts.push(remainingText);
    }

    return parts.length > 0 ? parts : <span style={{ color: '#999' }}>{placeholder}</span>;
  }, [value, fileMentions, placeholder, onMentionClick]);

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
      onKeyUp={handleKeyUp}
      onFocus={onFocus}
      role="textbox"
      tabIndex={disabled ? -1 : 0}
      style={{
        minHeight: '24px',
        outline: 'none',
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
        padding: '8px',
      }}
      data-placeholder={placeholder}
    >
      {renderContent()}
    </div>
  );
};

const MarkdownEditorWithRef = forwardRef<HTMLDivElement, MarkdownEditorProps>(MarkdownEditorComponent);

export const MarkdownEditor = memo(MarkdownEditorWithRef);
