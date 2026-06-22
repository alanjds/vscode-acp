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

export function createDefaultTeamTimeline(includeTester = false): PipelineTimelineStep[] {
  const steps: PipelineTimelineStep[] = [
    { id: 'planner', label: 'Planner', status: 'pending' },
    { id: 'approval', label: 'Plan approval (human)', status: 'pending' },
    { id: 'implementer', label: 'Implementer', status: 'pending' },
    { id: 'reviewer', label: 'Reviewer', status: 'pending' },
  ];
  if (includeTester) {
    steps.push({ id: 'tester', label: 'Tester', status: 'pending' });
  }
  return steps;
}

export function applyPipelineStatusToTimeline(
  timeline: PipelineTimelineStep[],
  status: string | undefined,
  stepId?: string,
): PipelineTimelineStep[] {
  if (!status) {
    return timeline;
  }

  const next = timeline.map(step => ({ ...step }));

  const markDoneUntil = (targetId: string, includeTarget = false): void => {
    for (const step of next) {
      if (step.id === targetId) {
        if (includeTarget) {
          step.status = 'done';
        }
        break;
      }
      if (step.status !== 'error' && step.status !== 'skipped') {
        step.status = 'done';
      }
    }
  };

  switch (status) {
    case 'planning':
      markDoneUntil('planner');
      setStepStatus(next, 'planner', 'running');
      break;
    case 'awaiting_approval':
      markDoneUntil('approval');
      setStepStatus(next, 'planner', 'done');
      setStepStatus(next, 'approval', 'running');
      break;
    case 'implementing':
      markDoneUntil('implementer');
      setStepStatus(next, 'planner', 'done');
      setStepStatus(next, 'approval', 'done');
      setStepStatus(next, 'implementer', 'running');
      break;
    case 'reviewing':
      markDoneUntil('reviewer');
      setStepStatus(next, 'implementer', 'done');
      setStepStatus(next, 'reviewer', 'running');
      break;
    case 'testing':
      markDoneUntil('tester');
      setStepStatus(next, 'reviewer', 'done');
      setStepStatus(next, 'tester', 'running');
      break;
    case 'completed':
      for (const step of next) {
        if (step.status !== 'error' && step.status !== 'skipped') {
          step.status = 'done';
        }
      }
      break;
    case 'rejected':
      setStepStatus(next, stepId === 'implementer' ? 'implementer' : 'approval', 'error');
      break;
    case 'error':
      if (stepId) {
        setStepStatus(next, stepId, 'error');
      }
      break;
    case 'cancelled':
      for (const step of next) {
        if (step.status === 'running') {
          step.status = 'skipped';
        }
      }
      break;
  }

  return next;
}

function setStepStatus(
  timeline: PipelineTimelineStep[],
  stepId: string,
  status: PipelineTimelineStepStatus,
): void {
  const step = timeline.find(entry => entry.id === stepId);
  if (step) {
    step.status = status;
  }
}
