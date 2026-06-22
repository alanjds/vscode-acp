import { memo } from 'react';
import type { JSX } from 'react';

import type { PlanHistoryItem } from '../chatTypes';
import { Codicon } from './Codicon';
import { MarkdownDisplay } from './MarkdownDisplay';

export type PlanBlockProps = {
  item: PlanHistoryItem;
};

function getPlanEntryIcon(status?: string): { name: string; spin?: boolean } {
  if (status === 'completed') {
    return { name: 'check' };
  }
  if (status === 'in_progress') {
    return { name: 'sync', spin: true };
  }
  return { name: 'circle-large-outline' };
}

function PlanBlockComponent({ item }: PlanBlockProps): JSX.Element {
  return (
    <div className="plan">
      <div className="plan-title">Plan</div>
      {item.plan.entries?.map((entry, index) => {
        const icon = getPlanEntryIcon(entry.status);
        return (
          <div
            className={`plan-entry${entry.status === 'completed' ? ' completed' : ''}`}
            key={`plan-entry-${index}`}
          >
            <Codicon className="plan-entry-icon" name={icon.name} spin={icon.spin} />
            <MarkdownDisplay>
              {entry.title || entry.description || entry.content || ''}
            </MarkdownDisplay>
          </div>
        );
      })}
    </div>
  );
}

export const PlanBlock = memo(PlanBlockComponent);
