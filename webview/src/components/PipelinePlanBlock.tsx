import { useEffect, useState, type JSX } from 'react';

import type { PipelinePlanHistoryItem } from '../chatTypes';

export interface PipelinePlanBlockProps {
  item: PipelinePlanHistoryItem;
  onApprove: (plan: string) => void;
  onReject: () => void;
}

export function PipelinePlanBlock({
  item,
  onApprove,
  onReject,
}: PipelinePlanBlockProps): JSX.Element {
  const [draft, setDraft] = useState(item.plan);
  const isPending = item.status === 'pending';
  const isBusy = item.status === 'implementing';

  useEffect(() => {
    if (isPending) {
      setDraft(item.plan);
    }
  }, [item.plan, isPending]);

  return (
    <div className={`pipeline-plan pipeline-plan-${item.status}`}>
      <div className="pipeline-plan-header">
        <div>
          <div className="pipeline-plan-title">Proposed Plan</div>
          {item.message ? <div className="pipeline-plan-status">{item.message}</div> : null}
        </div>
        {isBusy ? <span className="spinner" /> : null}
      </div>
      <textarea
        className="pipeline-plan-editor"
        disabled={!isPending}
        onChange={(event) => setDraft(event.target.value)}
        spellCheck={false}
        value={draft}
      />
      {isPending ? (
        <div className="pipeline-plan-actions">
          <button
            className="pipeline-plan-btn secondary"
            type="button"
            onClick={onReject}
          >
            Reject
          </button>
          <button
            className="pipeline-plan-btn primary"
            type="button"
            onClick={() => onApprove(draft)}
          >
            Approve
          </button>
        </div>
      ) : null}
    </div>
  );
}

