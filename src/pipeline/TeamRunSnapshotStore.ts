import type { PipelineExecutor } from './PipelineExecutor';
import type { PipelineRunState } from './PipelineRunRegistry';
import { TeamReviewerRerun } from './TeamReviewerRerun';

export interface TeamReviewerSessionUpdate {
  sessionId: string;
  phase: string;
  update: import('@agentclientprotocol/sdk').SessionNotification;
  stepId?: string;
  branchId?: string;
  role?: import('../config/AgentTeamConfig').TeamRoleId;
  agentName?: string;
  teamId?: string;
}

export interface TeamRunSnapshot {
  sessionId: string;
  teamId: string;
  teamTitle: string;
  approvedPlan: string;
  implementOutput: string;
  completedAt: string;
}

export interface TeamRunSnapshotStoreDependencies {
  workspaceCwd: () => string;
  readAgentConfigs: () => Record<string, unknown>;
  executor: PipelineExecutor;
  emitSessionUpdate: (event: TeamReviewerSessionUpdate) => void;
}

export class TeamRunSnapshotStore {
  private lastTeamRunSnapshot: TeamRunSnapshot | null = null;
  private readonly reviewerRerun: TeamReviewerRerun;

  constructor(private readonly dependencies: TeamRunSnapshotStoreDependencies) {
    this.reviewerRerun = new TeamReviewerRerun({
      workspaceCwd: dependencies.workspaceCwd,
      readAgentConfigs: dependencies.readAgentConfigs,
      executor: dependencies.executor,
      emitSessionUpdate: dependencies.emitSessionUpdate,
    });
  }

  getLastTeamRunSnapshot(): TeamRunSnapshot | null {
    return this.lastTeamRunSnapshot;
  }

  cancelReviewerRerun(): void {
    this.reviewerRerun.cancel();
  }

  abortReviewerRerunOnDispose(): void {
    this.reviewerRerun.abortOnDispose();
  }

  persistTeamSnapshot(sessionId: string, state: PipelineRunState, result: any): void {
    const metadata = state.pipeline.metadata;
    if (!metadata || metadata.sourceKind !== 'team') {
      return;
    }

    const approvedPlan = state.approvedPlan
      ?? result?.stepOutputs?.approval?.output
      ?? '';
    const implementOutput = state.implementOutput
      ?? result?.stepOutputs?.implementer?.output
      ?? '';

    if (!approvedPlan || !implementOutput) {
      return;
    }

    this.lastTeamRunSnapshot = {
      sessionId,
      teamId: metadata.teamId,
      teamTitle: state.pipeline.title,
      approvedPlan,
      implementOutput,
      completedAt: new Date().toISOString(),
    };
  }

  async rerunTeamReviewer(teamAgentName: string): Promise<string> {
    const snapshot = this.lastTeamRunSnapshot;
    if (!snapshot) {
      throw new Error('No completed team run is available for reviewer re-run.');
    }
    return this.reviewerRerun.rerun(snapshot, teamAgentName);
  }
}
