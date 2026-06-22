import { memo, useCallback, useMemo } from 'react';
import type { JSX } from 'react';

import type { CurrentTurn } from '../chatTypes';
import { TurnBlock } from './TurnBlock';

export type CurrentTurnBlockProps = {
  currentTurn: CurrentTurn;
  collapsed: boolean;
  onMentionClick: (path: string) => void;
  onToggleCollapsedTools: (key: string, collapsed: boolean) => void;
  onThoughtOpenChange: (open: boolean) => void;
};

function CurrentTurnBlockComponent({
  currentTurn,
  collapsed,
  onMentionClick,
  onToggleCollapsedTools,
  onThoughtOpenChange,
}: CurrentTurnBlockProps): JSX.Element {
  const handleToggleTools = useCallback(() => {
    onToggleCollapsedTools('current-turn', collapsed);
  }, [collapsed, onToggleCollapsedTools]);

  const thought = useMemo(
    () =>
      currentTurn.thought
        ? {
            text: currentTurn.thought.text,
            durationSec: null,
            isStreaming: currentTurn.thought.finishedAt === null,
            open: currentTurn.thought.isOpen,
            onToggle: onThoughtOpenChange,
          }
        : null,
    [currentTurn.thought, onThoughtOpenChange],
  );

  const assistantText = useMemo(
    () => (currentTurn.assistantText.trim().length > 0 ? currentTurn.assistantText : undefined),
    [currentTurn.assistantText],
  );

  return (
    <div className="conversation-turn current">
      <TurnBlock
        assistantText={assistantText}
        planningDraftText={currentTurn.planningDraft}
        collapsed={collapsed}
        onToggleTools={handleToggleTools}
        thought={thought}
        toolCalls={currentTurn.toolCalls}
        turnKey="current-turn"
        onMentionClick={onMentionClick}
      />
    </div>
  );
}

export const CurrentTurnBlock = memo(CurrentTurnBlockComponent);
