import { memo } from 'react';
import type { JSX } from 'react';

import type { CurrentToolCall, ToolCallHistoryItem } from '../chatTypes';
import { PlanningDraftBlock } from './PlanningDraftBlock';
import { ThoughtBlock, type ThoughtBlockProps } from './ThoughtBlock';
import { TurnTools } from './TurnTools';
import { MarkdownDisplay } from './MarkdownDisplay';

type TurnToolHistoryItem = {
  item: ToolCallHistoryItem;
  historyIndex: number;
};

export type TurnBlockProps = {
  turnKey: string;
  thought: ThoughtBlockProps | null;
  planningDraftText?: string;
  assistantText?: string;
  toolCalls: CurrentToolCall[] | TurnToolHistoryItem[];
  collapsed: boolean;
  onToggleTools: () => void;
  onMentionClick?: (path: string) => void;
};

function TurnBlockComponent({
  turnKey,
  thought,
  planningDraftText,
  assistantText,
  toolCalls,
  collapsed,
  onToggleTools,
  onMentionClick,
}: TurnBlockProps): JSX.Element | null {
  const hasAssistantContent = typeof assistantText === 'string' && assistantText.trim().length > 0;
  const hasAssistant = hasAssistantContent;
  const hasPlanningDraft = typeof planningDraftText === 'string' && planningDraftText.trim().length > 0;
  const hasVisibleContent = Boolean(thought) || hasPlanningDraft || hasAssistant || toolCalls.length > 0;

  if (!hasVisibleContent) {
    return null;
  }

  return (
    <div className="turn" key={turnKey}>
      {thought ? <ThoughtBlock {...thought} /> : null}
      {hasPlanningDraft ? <PlanningDraftBlock text={planningDraftText ?? ''} /> : null}
      {hasAssistant ? (
        <div className={`message assistant md-rendered`}>
          <MarkdownDisplay onMentionClick={onMentionClick}>
            {assistantText || ''}
          </MarkdownDisplay>
        </div>
      ) : null}
      <TurnTools turnKey={turnKey} toolCalls={toolCalls} collapsed={collapsed} onToggle={onToggleTools} />
    </div>
  );
}

export const TurnBlock = memo(TurnBlockComponent);
