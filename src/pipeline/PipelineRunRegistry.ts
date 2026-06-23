import type { PipelineDefinition } from '../config/PipelineCatalog';

import type { CompiledPipelineGraph } from './PipelineGraphCompiler';

export interface PendingApprovalState {
  stepId: string;
  plan: string;
}

export interface PipelineRunState {
  pipeline: PipelineDefinition;
  graph: CompiledPipelineGraph;
  pendingApproval: PendingApprovalState | null;
  originalUserPrompt: string;
  revisionCount: number;
  cancelled: boolean;
  abortController: AbortController;
  approvedPlan?: string;
  implementOutput?: string;
  stepOutputs: Map<string, string>;
}

export class PipelineRunRegistry {
  private readonly runs = new Map<string, PipelineRunState>();

  get(sessionId: string): PipelineRunState | undefined {
    return this.runs.get(sessionId);
  }

  set(sessionId: string, state: PipelineRunState): void {
    this.runs.set(sessionId, state);
  }

  delete(sessionId: string): boolean {
    return this.runs.delete(sessionId);
  }

  clear(): void {
    this.runs.clear();
  }

  entries(): IterableIterator<[string, PipelineRunState]> {
    return this.runs.entries();
  }

  markCancelled(sessionId: string): PipelineRunState | undefined {
    const state = this.runs.get(sessionId);
    if (state) {
      state.cancelled = true;
      state.abortController.abort();
    }
    return state;
  }

  throwIfCancelled(state: PipelineRunState): void {
    if (state.cancelled) {
      throw new Error('Pipeline cancelled.');
    }
  }
}
