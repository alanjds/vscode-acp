import type { JSX } from 'react';

import type { PipelineTimelineStep, PipelineTimelineStepStatus } from '../chatTypes';

export interface PipelineRoleTimelineProps {
  timeline: PipelineTimelineStep[];
}

function statusLabel(status: PipelineTimelineStepStatus): string {
  switch (status) {
    case 'running':
      return 'Running';
    case 'done':
      return 'Done';
    case 'error':
      return 'Error';
    case 'skipped':
      return 'Skipped';
    default:
      return 'Pending';
  }
}

export function PipelineRoleTimeline({ timeline }: PipelineRoleTimelineProps): JSX.Element | null {
  if (timeline.length === 0) {
    return null;
  }

  return (
    <div className="pipeline-role-timeline">
      {timeline.map((step, index) => (
        <div className={`pipeline-role-step pipeline-role-step-${step.status}`} key={step.id}>
          <div className="pipeline-role-step-marker">{index + 1}</div>
          <div className="pipeline-role-step-body">
            <div className="pipeline-role-step-label">{step.label}</div>
            <div className="pipeline-role-step-status">{statusLabel(step.status)}</div>
          </div>
          {index < timeline.length - 1 ? <div className="pipeline-role-step-connector" /> : null}
        </div>
      ))}
    </div>
  );
}
