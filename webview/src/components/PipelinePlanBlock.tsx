import { memo, useEffect, useState, type JSX } from 'react';

import type { PipelinePlanState } from '../app/OrchestrationProjector';
import { MarkdownDisplay } from './MarkdownDisplay';
import { MarkdownEditor } from './MarkdownEditor';

export interface PipelinePlanBlockProps {
  item: PipelinePlanState;
  onApprove: (plan: string) => void;
  onReject: () => void;
}

function PipelinePlanBlockComponent({
  item,
  onApprove,
  onReject,
}: PipelinePlanBlockProps): JSX.Element {
  const [draft, setDraft] = useState(item.plan);
  const isPending = item.status === 'pending';
  const isBusy = item.status === 'implementing';
  const title = isPending
    ? 'Proposed plan — approval required'
    : item.role === 'planner' && item.agentName
      ? `Proposed Plan — Planner (${item.agentName})`
      : 'Proposed Plan';
  const subtitle = isPending && item.implementerUsesSandcastle
    ? 'File changes will be isolated in Sandcastle after you approve the plan.'
    : undefined;

  useEffect(() => {
    if (isPending) {
      setDraft(item.plan);
    }
  }, [item.plan, isPending]);

  return (
    <div className={`pipeline-plan pipeline-plan-${item.status}`}>
      <div className="pipeline-plan-header">
        <div>
          <div className="pipeline-plan-title">{title}</div>
          {subtitle ? <div className="pipeline-plan-subtitle">{subtitle}</div> : null}
          {item.message ? <div className="pipeline-plan-status"><MarkdownDisplay>{item.message}</MarkdownDisplay></div> : null}
        </div>
        {isBusy ? <span className="spinner" /> : null}
      </div>
      {isPending ? (
        <>
          <MarkdownEditor
            value={draft}
            onChange={setDraft}
            placeholder="Edit the plan..."
            disabled={false}
          />
          <div className="pipeline-plan-actions">
            <button
              className="pipeline-plan-btn secondary"
              type="button"
              onClick={onReject}
            >
              Reject plan
            </button>
            <button
              className="pipeline-plan-btn primary"
              type="button"
              onClick={() => onApprove(draft)}
            >
              Approve plan
            </button>
          </div>
        </>
      ) : (
        <div className="pipeline-plan-viewer">
          <MarkdownDisplay>{item.plan}</MarkdownDisplay>
        </div>
      )}
    </div>
  );
}

export const PipelinePlanBlock = memo(PipelinePlanBlockComponent);
