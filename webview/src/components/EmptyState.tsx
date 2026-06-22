import { memo } from 'react';
import type { JSX } from 'react';

import { Codicon } from './Codicon';

export type EmptyStateProps = {
  onConnectAgent: () => void;
  onAddAgent: () => void;
};

function EmptyStateComponent({ onConnectAgent, onAddAgent }: EmptyStateProps): JSX.Element {
  return (
    <div className="empty-state" id="emptyState">
      <div className="icon">
        <Codicon name="comment-discussion" />
      </div>
      <div className="title">ACP Chat</div>
      <div className="subtitle">Connect to an AI coding agent to start chatting.</div>
      <div className="actions">
        <button
          className="action-btn primary"
          id="welcomeConnectAgent"
          type="button"
          onClick={onConnectAgent}
        >
          <Codicon name="plug" />
          Connect to Agent
        </button>
        <button
          className="action-btn secondary"
          id="welcomeAddAgent"
          type="button"
          onClick={onAddAgent}
        >
          <Codicon name="add" />
          Add Agent
        </button>
      </div>
      <div className="hint">
        or press <kbd>Ctrl+Shift+A</kbd> anytime
      </div>
    </div>
  );
}

export const EmptyState = memo(EmptyStateComponent);
