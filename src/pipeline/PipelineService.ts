import { EventEmitter } from 'node:events';

import type { PipelineDefinition } from '../config/PipelineCatalog';
import type { SandcastlePromotion } from '../sandcastle/SandcastlePromotion';
import type { AcpRunCallback } from './PipelineGraphCompiler';
import { PipelineRunEngine } from './PipelineRunEngine';
import type { PipelineStepRunResult } from './PipelineStepCompletion';

export type {
  PipelineStatus,
  PipelineStatusEvent,
  PipelinePlanReadyEvent,
  PipelineSessionUpdateEvent,
  PipelineExecutorKind,
} from './PipelineEvents';
export type { TeamRunSnapshot } from './TeamRunSnapshotStore';

export interface PipelineServiceDependencies {
  getPipelineDefinitions?: () => PipelineDefinition[];
  getPipelineDefinitionForAgent?: (agentName: string) => PipelineDefinition | null;
  getAgentConfigs?: () => Record<string, unknown>;
  runAcpAgent?: (...args: Parameters<AcpRunCallback>) => Promise<PipelineStepRunResult>;
  sandcastlePromotion?: SandcastlePromotion;
}

export class PipelineService extends EventEmitter {
  private readonly engine: PipelineRunEngine;

  constructor(
    workspaceCwd: () => string,
    dependencies: PipelineServiceDependencies = {},
  ) {
    super();
    this.engine = new PipelineRunEngine(workspaceCwd, dependencies);
    this.engine.on('status', event => {
      this.emit('status', event);
    });
    this.engine.on('plan-ready', event => {
      this.emit('plan-ready', event);
    });
    this.engine.on('session-update', event => {
      this.emit('session-update', event);
    });
  }

  async createPlan(sessionId: string, userPrompt: string, pipelineAgentName?: string): Promise<string> {
    return this.engine.createPlan(sessionId, userPrompt, pipelineAgentName);
  }

  async approvePlan(sessionId: string, approvedPlan: string): Promise<string> {
    return this.engine.approvePlan(sessionId, approvedPlan);
  }

  rejectPlan(sessionId: string): void {
    this.engine.rejectPlan(sessionId);
  }

  cancel(sessionId: string): void {
    this.engine.cancel(sessionId);
  }

  async dispose(): Promise<void> {
    await this.engine.dispose();
    this.removeAllListeners();
  }

  getLastTeamRunSnapshot() {
    return this.engine.getLastTeamRunSnapshot();
  }

  getCompiledPipelineForTeam(agentName: string): PipelineDefinition | null {
    return this.engine.getCompiledPipelineForTeam(agentName);
  }

  cancelReviewerRerun(): void {
    this.engine.cancelReviewerRerun();
  }

  async rerunTeamReviewer(teamAgentName: string): Promise<string> {
    return this.engine.rerunTeamReviewer(teamAgentName);
  }
}
