import type { JSX } from 'react';

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
      <pre className="planning-draft-content">{text}</pre>
    </div>
  );
}
