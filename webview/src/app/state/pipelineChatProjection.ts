import type { PipelinePhase, PipelineTimelineStep } from '../../chatTypes';
import type { AppState } from './types';

export type OrchestrationSlice = {
  timeline: PipelineTimelineStep[];
  activeRole: PipelinePhase | null;
  activeAgentName: string | null;
};

export type PipelineChatProjection = {
  timeline: PipelineTimelineStep[];
  activeRole: PipelinePhase | null;
  activeAgentName: string | null;
  hasTimeline: boolean;
};

export function selectPipelineChatProjection(state: AppState): PipelineChatProjection {
  const { timeline, activeRole, activeAgentName } = state.orchestration;
  return {
    timeline,
    activeRole,
    activeAgentName,
    hasTimeline: timeline.length > 0,
  };
}

export function emptyOrchestrationSlice(): OrchestrationSlice {
  return {
    timeline: [],
    activeRole: null,
    activeAgentName: null,
  };
}
