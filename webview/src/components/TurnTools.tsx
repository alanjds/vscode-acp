import { memo, useMemo } from 'react';
import type { JSX } from 'react';

import type { CurrentToolCall, ToolCallHistoryItem, ToolCallStatus } from '../chatTypes';
import { Codicon } from './Codicon';

type TurnToolHistoryItem = {
  item: ToolCallHistoryItem;
  historyIndex: number;
};

export type TurnToolsProps = {
  turnKey: string;
  toolCalls: CurrentToolCall[] | TurnToolHistoryItem[];
  collapsed: boolean;
  onToggle: () => void;
};

function getStatusIcon(status: ToolCallStatus): { name: string; spin?: boolean } {
  switch (status) {
    case 'running':
      return { name: 'sync', spin: true };
    case 'completed':
      return { name: 'check' };
    case 'failed':
      return { name: 'close' };
    default:
      return { name: 'ellipsis' };
  }
}

function TurnToolsComponent({ turnKey, toolCalls, collapsed, onToggle }: TurnToolsProps): JSX.Element | null {
  const items = useMemo(
    () =>
      toolCalls.map((toolCall) =>
        'item' in toolCall
          ? {
              key: `${turnKey}-tool-${toolCall.historyIndex}`,
              toolCallId: toolCall.item.toolCallId,
              title: toolCall.item.title,
              status: toolCall.item.status,
            }
          : {
              key: `${turnKey}-tool-${toolCall.toolCallId}`,
              toolCallId: toolCall.toolCallId,
              title: toolCall.title,
              status: toolCall.status,
            },
      ),
    [toolCalls, turnKey],
  );

  if (toolCalls.length === 0) {
    return null;
  }

  const count = items.length;
  const summaryLabel = `${count} tool call${count !== 1 ? 's' : ''}`;

  return (
    <div className="turn-tools">
      <button
        className="turn-tools-summary"
        data-count={count}
        onClick={onToggle}
        type="button"
      >
        <Codicon className="turn-tools-chevron" name={collapsed ? 'chevron-right' : 'chevron-down'} />
        <Codicon name="tools" />
        {summaryLabel}
      </button>
      <div className={`turn-tools-list${collapsed ? ' collapsed' : ''}`}>
        {items.map((toolCall) => {
          const icon = getStatusIcon(toolCall.status);
          return (
            <div className="tool-call-inline" id={`tc-${toolCall.toolCallId}`} key={toolCall.key}>
              <span className={`tc-icon ${toolCall.status}`}>
                <Codicon name={icon.name} spin={icon.spin} />
              </span>
              <span className="tc-title">{toolCall.title || 'Tool Call'}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export const TurnTools = memo(TurnToolsComponent);
