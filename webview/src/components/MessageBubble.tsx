import { memo, useMemo } from 'react';
import type { JSX } from 'react';

import type { MessageHistoryItem } from '../chatTypes';
import { parseUserMessage } from '../app/composer';

export type MessageBubbleProps = {
  item: MessageHistoryItem;
  renderedHtml?: string;
};

function MessageBubbleComponent({ item, renderedHtml }: MessageBubbleProps): JSX.Element {
  const parsedUserMessage = useMemo(
    () => (item.role === 'user' ? parseUserMessage(item.text) : null),
    [item],
  );

  if (item.role === 'assistant') {
    return (
      <div
        className={`message assistant${renderedHtml ? ' md-rendered' : ''}`}
        {...(renderedHtml ? { dangerouslySetInnerHTML: { __html: renderedHtml } } : {})}
      >
        {!renderedHtml ? item.text : null}
      </div>
    );
  }

  if (item.role === 'error') {
    return <div className="message error">{item.text}</div>;
  }

  if (item.role === 'info') {
    return <div className="message info">{item.text}</div>;
  }

  if (!parsedUserMessage) {
    return <div className="message user">{item.text}</div>;
  }

  return (
    <div className="message user">
      <span className="file-badge">📄 {parsedUserMessage.badgeText}</span>
      {parsedUserMessage.body ? <div className="message-text">{parsedUserMessage.body}</div> : null}
    </div>
  );
}

export const MessageBubble = memo(MessageBubbleComponent);
