import { Children, memo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

import { decodeFileMentionPath } from '../app/composer';

export type MarkdownDisplayProps = {
  children: string;
  className?: string;
  onMentionClick?: (path: string) => void;
};

// Composant pour afficher les mentions de fichiers comme des chips
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

// Composant principal pour afficher le markdown
const MarkdownDisplayComponent = ({
  children,
  className = '',
  onMentionClick,
}: MarkdownDisplayProps) => {
  return (
    <div className={`markdown-display md-rendered ${className}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a({ node, href, children, ...props }) {
            if (typeof href === 'string' && href.startsWith('file://')) {
              const path = decodeFileMentionPath(href.slice('file://'.length));
              const rawName = Children.toArray(children).join('');
              const name = rawName.startsWith('@') ? rawName.slice(1) : rawName;
              return (
                <FileMentionChip
                  path={path}
                  name={name || path.split('/').pop() || path}
                  onClick={onMentionClick}
                />
              );
            }

            return (
              <a
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: '#4f8ef7' }}
                {...props}
              >
              {children}
            </a>
          );
          },
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
};

export const MarkdownDisplay = memo(MarkdownDisplayComponent);
