import { Children, memo, useMemo, useRef, type ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

import { decodeFileMentionPath } from '../app/composer';

export type MarkdownDisplayProps = {
  children: string;
  className?: string;
  onMentionClick?: (path: string) => void;
};

const REMARK_PLUGINS = [remarkGfm];

const FileMentionChip = ({
  path,
  name,
  onClick,
}: {
  path: string;
  name: string;
  onClick?: (path: string) => void;
}) => (
  <span
    className="prompt-file-mention"
    data-file-path={path}
    data-file-name={name}
    title={`Click to open ${path}`}
    onClick={(e) => {
      if (onClick) {
        e.preventDefault();
        e.stopPropagation();
        onClick(path);
      }
    }}
  >
    {name}
  </span>
);

const MarkdownDisplayComponent = ({
  children,
  className = '',
  onMentionClick,
}: MarkdownDisplayProps) => {
  const onMentionClickRef = useRef(onMentionClick);
  onMentionClickRef.current = onMentionClick;

  const components = useMemo(
    () => ({
      a({ href, children: linkChildren, ...props }: {
        href?: string;
        children?: ReactNode;
      }) {
        if (typeof href === 'string' && href.startsWith('file://')) {
          const path = decodeFileMentionPath(href.slice('file://'.length));
          const rawName = Children.toArray(linkChildren).join('');
          const name = rawName.startsWith('@') ? rawName.slice(1) : rawName;
          return (
            <FileMentionChip
              path={path}
              name={name || path.split('/').pop() || path}
              onClick={onMentionClickRef.current}
            />
          );
        }

        return (
          <a href={href} target="_blank" rel="noopener noreferrer" {...props}>
            {linkChildren}
          </a>
        );
      },
    }),
    [],
  );

  return (
    <div className={`markdown-display md-rendered ${className}`}>
      <ReactMarkdown remarkPlugins={REMARK_PLUGINS} components={components}>
        {children}
      </ReactMarkdown>
    </div>
  );
};

export const MarkdownDisplay = memo(MarkdownDisplayComponent);
