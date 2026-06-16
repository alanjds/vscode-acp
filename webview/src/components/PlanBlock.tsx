import type { JSX } from 'react';

import type { PlanHistoryItem } from '../chatTypes';
import { MarkdownDisplay } from './MarkdownDisplay';

export type PlanBlockProps = {
  item: PlanHistoryItem;
};

function getPlanEntryIcon(status?: string): string {
  if (status === 'completed') {
    return '✅';
  }
  if (status === 'in_progress') {
    return '🔄';
  }
  return '⬜';
}

export function PlanBlock({ item }: PlanBlockProps): JSX.Element {
  return (
    <div className="plan">
      <div className="plan-title">Plan</div>
      {item.plan.entries?.map((entry, index) => (
        <div
          className={`plan-entry${entry.status === 'completed' ? ' completed' : ''}`}
          key={`plan-entry-${index}`}
        >
          <span style={{ marginRight: '8px' }}>{getPlanEntryIcon(entry.status)}</span>
          <MarkdownDisplay>
            {entry.title || entry.description || entry.content || ''}
          </MarkdownDisplay>
        </div>
      ))}
    </div>
  );
}
