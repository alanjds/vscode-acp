import { memo, useMemo } from 'react';
import type { JSX } from 'react';

import type { MessageHistoryItem } from '../chatTypes';
import { parseUserMessage } from '../app/composer';
import { MarkdownDisplay } from './MarkdownDisplay';
import { Codicon } from './Codicon';

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
      <div className="message assistant md-rendered">
        <MarkdownDisplay onMentionClick={onMentionClick}>
          {item.text}
        </MarkdownDisplay>
      </div>
    );
  }

  if (item.role === 'error') {
    return (
      <div className="message error md-rendered">
        <Codicon className="message-status-icon" name="error" />
        <MarkdownDisplay>{item.text}</MarkdownDisplay>
      </div>
    );
  }

  if (item.role === 'info') {
    return (
      <div className="message info md-rendered">
        <Codicon className="message-status-icon" name="info" />
        <MarkdownDisplay>{item.text}</MarkdownDisplay>
      </div>
    );
  }

  if (!parsedUserMessage) {
    return (
      <div className="message user md-rendered">
        <MarkdownDisplay>{item.text}</MarkdownDisplay>
      </div>
    );
  }

  return (
    <div className="message user md-rendered">
      <span className="file-badge">
        <Codicon name="file" />
        {parsedUserMessage.badgeText}
      </span>
      {parsedUserMessage.body ? (
        <div className="message-text">
          <MarkdownDisplay>{parsedUserMessage.body}</MarkdownDisplay>
        </div>
      ) : null}
    </div>
  );
}

export const MessageBubble = memo(MessageBubbleComponent);
