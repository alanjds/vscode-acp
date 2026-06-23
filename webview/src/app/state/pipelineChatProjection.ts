import type { AppState } from './types';
import {
  emptyOrchestrationSlice,
  projectOrchestrationView,
  type OrchestrationSlice,
  type OrchestrationViewModel,
} from '../OrchestrationProjector';

export type {
  OrchestrationSlice,
  PipelinePlanState,
  PipelineRoleOutputItem,
} from '../OrchestrationProjector';

export type PipelineChatProjection = OrchestrationViewModel;

export function selectPipelineChatProjection(state: AppState): PipelineChatProjection {
  return projectOrchestrationView(state.orchestration);
}

export { emptyOrchestrationSlice };
