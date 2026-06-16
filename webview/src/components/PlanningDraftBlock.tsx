import type { JSX } from 'react';

import { MarkdownDisplay } from './MarkdownDisplay';

export type PlanningDraftBlockProps = {
  text: string;
};

export function PlanningDraftBlock({ text }: PlanningDraftBlockProps): JSX.Element | null {
  if (text.trim().length === 0) {
    return null;
  }

  return (
    <div className="planning-draft">
      <div className="planning-draft-title">Planning draft</div>
      <div className="planning-draft-content md-rendered">
        <MarkdownDisplay>{text}</MarkdownDisplay>
      </div>
    </div>
  );
}
