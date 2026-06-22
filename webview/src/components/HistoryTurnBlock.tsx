import { memo, useCallback, useMemo } from 'react';
import type { JSX } from 'react';

import type { HistoryTurnBlock as HistoryTurnBlockData } from '../app/history';
import { TurnBlock } from './TurnBlock';

export type HistoryTurnBlockProps = {
  block: HistoryTurnBlockData;
  collapsed: boolean;
  onMentionClick: (path: string) => void;
  onToggleCollapsedTools: (key: string, collapsed: boolean) => void;
};

function HistoryTurnBlockComponent({
  block,
  collapsed,
  onMentionClick,
  onToggleCollapsedTools,
}: HistoryTurnBlockProps): JSX.Element {
  const handleToggleTools = useCallback(() => {
    onToggleCollapsedTools(block.key, collapsed);
  }, [block.key, collapsed, onToggleCollapsedTools]);

  const thought = useMemo(
    () =>
      block.thought
        ? {
            text: block.thought.item.text,
            durationSec: block.thought.item.durationSec,
            isStreaming: false as const,
          }
        : null,
    [block.thought],
  );

  return (
    <div className="conversation-turn">
      <TurnBlock
        assistantText={block.assistant?.item.text}
        collapsed={collapsed}
        onToggleTools={handleToggleTools}
        thought={thought}
        toolCalls={block.toolCalls}
        turnKey={block.key}
        onMentionClick={onMentionClick}
      />
    </div>
  );
}

export const HistoryTurnBlock = memo(HistoryTurnBlockComponent);
