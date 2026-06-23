export type PipelinePlanStatus =
  | 'pending'
  | 'implementing'
  | 'completed'
  | 'rejected'
  | 'error'
  | 'cancelled';

export type PipelinePhase = 'planner' | 'implementer' | 'reviewer' | 'tester' | 'reviewer-rerun';

export type PipelineTimelineStepStatus = 'pending' | 'running' | 'done' | 'error' | 'skipped';

export type PipelineTimelineStep = {
  id: string;
  label: string;
  status: PipelineTimelineStepStatus;
};

const PIPELINE_PHASES = new Set<PipelinePhase>([
  'planner',
  'implementer',
  'reviewer',
  'tester',
  'reviewer-rerun',
]);

const TIMELINE_STEP_STATUSES = new Set<PipelineTimelineStepStatus>([
  'pending',
  'running',
  'done',
  'error',
  'skipped',
]);

const PIPELINE_PLAN_STATUSES = new Set<PipelinePlanStatus>([
  'pending',
  'implementing',
  'completed',
  'rejected',
  'error',
  'cancelled',
]);

export function normalizePipelinePhase(value: unknown): PipelinePhase | null {
  return typeof value === 'string' && PIPELINE_PHASES.has(value as PipelinePhase)
    ? value as PipelinePhase
    : null;
}

export function normalizePipelinePlanStatus(value: unknown): PipelinePlanStatus | null {
  return typeof value === 'string' && PIPELINE_PLAN_STATUSES.has(value as PipelinePlanStatus)
    ? value as PipelinePlanStatus
    : null;
}

export function normalizePipelineTimelineStepStatus(value: unknown): PipelineTimelineStepStatus {
  return typeof value === 'string' && TIMELINE_STEP_STATUSES.has(value as PipelineTimelineStepStatus)
    ? value as PipelineTimelineStepStatus
    : 'pending';
}

export function normalizePipelineTimelineStep(value: unknown): PipelineTimelineStep | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const candidate = value as Partial<PipelineTimelineStep>;
  if (typeof candidate.id !== 'string' || typeof candidate.label !== 'string') {
    return null;
  }
  return {
    id: candidate.id,
    label: candidate.label,
    status: normalizePipelineTimelineStepStatus(candidate.status),
  };
}

export function normalizePipelineTimeline(value: unknown): PipelineTimelineStep[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap(entry => {
    const step = normalizePipelineTimelineStep(entry);
    return step ? [step] : [];
  });
}
