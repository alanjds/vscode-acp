import React, { memo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

export type MarkdownDisplayProps = {
  children: string;
  className?: string;
  fileMentions?: Array<{ token: string; path: string; name: string }>;
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
    style={{
      backgroundColor: '#e0f2fe',
      color: '#0369a1',
      padding: '2px 6px',
      borderRadius: '4px',
      margin: '0 2px',
      cursor: onClick ? 'pointer' : 'default',
      fontFamily: 'monospace',
      fontSize: '0.9em',
    }}
    onClick={(e) => {
      if (onClick) {
        e.preventDefault();
        e.stopPropagation();
        onClick(path);
      }
    }}
  >
    @{name}
  </span>
);

// Composant pour rendre un paragraphe avec les mentions transformées
const MarkdownParagraph = ({
  children,
  mentions,
  onMentionClick,
}: {
  children?: React.ReactNode;
  mentions?: Array<{ token: string; path: string; name: string }>;
  onMentionClick?: (path: string) => void;
}) => {
  if (typeof children !== 'string') {
    return <p>{children}</p>;
  }

  if (!mentions || mentions.length === 0) {
    return <p>{children}</p>;
  }

  // Diviser le texte et insérer les chips
  const parts: React.ReactNode[] = [];
  let remaining = children;

  // Trier par longueur du token (plus long d'abord) pour éviter les remplacements partiels
  const mentionsSorted = [...mentions].sort((a, b) => b.token.length - a.token.length);

  for (const mention of mentionsSorted) {
    const index = remaining.indexOf(mention.token);
    if (index === -1) continue;

    // Ajouter le texte avant
    if (index > 0) {
      parts.push(remaining.substring(0, index));
    }

    // Ajouter le chip
    parts.push(
      <FileMentionChip
        key={mention.token}
        path={mention.path}
        name={mention.name}
        onClick={onMentionClick}
      />
    );

    remaining = remaining.substring(index + mention.token.length);
  }

  // Ajouter le texte restant
  if (remaining) {
    parts.push(remaining);
  }

  return <p>{parts}</p>;
};

// Composant principal pour afficher le markdown
const MarkdownDisplayComponent = ({
  children,
  className = '',
  fileMentions,
  onMentionClick,
}: MarkdownDisplayProps) => {
  return (
    <div className={`markdown-display ${className}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          // Personnalisation des paragraphes pour gérer les mentions
          p({ node, children, ...props }) {
            return (
              <MarkdownParagraph mentions={fileMentions} onMentionClick={onMentionClick}>
                {children}
              </MarkdownParagraph>
            );
          },
          // Code blocks
          code({ node, className, children, ...props }) {
            const codeContent = String(children).replace(/\n$/, '');
            const isInline = !className || className === 'inline';
            
            return !isInline ? (
              <pre
                style={{
                  backgroundColor: '#282c34',
                  padding: '1em',
                  borderRadius: '4px',
                  overflowX: 'auto',
                  margin: '1em 0',
                }}
              >
                <code className={className} style={{ color: '#d4d4d4' }}>
                  {codeContent}
                </code>
              </pre>
            ) : (
              <code className={className} style={{ backgroundColor: '#f0f0f0', padding: '2px 4px', borderRadius: '3px' }}>
                {children}
              </code>
            );
          },
          // Liens
          a({ node, href, children, ...props }) {
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
          // Tableaux
          table({ node, children, ...props }) {
            return (
              <div style={{ overflowX: 'auto', margin: '1em 0' }}>
                <table
                  style={{
                    borderCollapse: 'collapse',
                    width: '100%',
                    border: '1px solid #ddd',
                  }}
                  {...props}
                >
                  {children}
                </table>
              </div>
            );
          },
          th({ node, children, ...props }) {
            return (
              <th
                style={{
                  backgroundColor: '#f5f5f5',
                  padding: '8px',
                  border: '1px solid #ddd',
                  textAlign: 'left',
                }}
                {...props}
              >
                {children}
              </th>
            );
          },
          td({ node, children, ...props }) {
            return (
              <td
                style={{
                  padding: '8px',
                  border: '1px solid #ddd',
                }}
                {...props}
              >
                {children}
              </td>
            );
          },
          // Bloc quotes
          blockquote({ node, children, ...props }) {
            return (
              <blockquote
                style={{
                  borderLeft: '3px solid #4f8ef7',
                  paddingLeft: '1em',
                  marginLeft: '0',
                  color: '#666',
                  fontStyle: 'italic',
                }}
                {...props}
              >
                {children}
              </blockquote>
            );
          },
          // Listes
          ul({ node, children, ...props }) {
            return (
              <ul style={{ paddingLeft: '2em', margin: '0.5em 0' }} {...props}>
                {children}
              </ul>
            );
          },
          ol({ node, children, ...props }) {
            return (
              <ol style={{ paddingLeft: '2em', margin: '0.5em 0' }} {...props}>
                {children}
              </ol>
            );
          },
          li({ node, children, ...props }) {
            return (
              <li style={{ margin: '0.25em 0' }} {...props}>
                {children}
              </li>
            );
          },
          // Titres
          h1({ node, children, ...props }) {
            return (
              <h1 style={{ fontSize: '1.8em', margin: '0.5em 0' }} {...props}>
                {children}
              </h1>
            );
          },
          h2({ node, children, ...props }) {
            return (
              <h2 style={{ fontSize: '1.5em', margin: '0.5em 0' }} {...props}>
                {children}
              </h2>
            );
          },
          h3({ node, children, ...props }) {
            return (
              <h3 style={{ fontSize: '1.25em', margin: '0.5em 0' }} {...props}>
                {children}
              </h3>
            );
          },
          // Horizontal rule
          hr({ node, ...props }) {
            return <hr style={{ border: 'none', borderTop: '1px solid #ddd', margin: '1em 0' }} {...props} />;
          },
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
};

export const MarkdownDisplay = memo(MarkdownDisplayComponent);
