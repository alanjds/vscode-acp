import { memo, useMemo } from 'react';
import type { JSX } from 'react';

import type { MessageHistoryItem } from '../chatTypes';
import { parseUserMessage } from '../app/composer';
import { MarkdownDisplay } from './MarkdownDisplay';

export type MessageBubbleProps = {
  item: MessageHistoryItem;
  onMentionClick?: (path: string) => void;
};

function MessageBubbleComponent({ item, onMentionClick }: MessageBubbleProps): JSX.Element {
  const parsedUserMessage = useMemo(
    () => (item.role === 'user' ? parseUserMessage(item.text) : null),
    [item],
  );

  if (item.role === 'assistant') {
    return (
      <div className={`message assistant md-rendered`}>
        <MarkdownDisplay onMentionClick={onMentionClick}>
          {item.text}
        </MarkdownDisplay>
      </div>
    );
  }

  if (item.role === 'error') {
    return (
      <div className="message error">
        <MarkdownDisplay>{item.text}</MarkdownDisplay>
      </div>
    );
  }

  if (item.role === 'info') {
    return (
      <div className="message info">
        <MarkdownDisplay>{item.text}</MarkdownDisplay>
      </div>
    );
  }

  if (!parsedUserMessage) {
    return (
      <div className="message user">
        <MarkdownDisplay>{item.text}</MarkdownDisplay>
      </div>
    );
  }

  return (
    <div className="message user">
      <span className="file-badge">📄 {parsedUserMessage.badgeText}</span>
      {parsedUserMessage.body ? (
        <div className="message-text">
          <MarkdownDisplay>{parsedUserMessage.body}</MarkdownDisplay>
        </div>
      ) : null}
    </div>
  );
}

export const MessageBubble = memo(MessageBubbleComponent);
