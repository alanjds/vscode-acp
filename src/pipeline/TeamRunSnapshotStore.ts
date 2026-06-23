import type { SessionNotification } from '@agentclientprotocol/sdk';

import { getTeamEntryForAgent } from '../config/AgentTeamCatalog';
import type { TeamRoleId } from '../config/AgentTeamConfig';
import { defaultGitCommandRunner } from '../git/GitCommandRunner';
import { buildReviewerRerunPrompt } from './AgentTeamCompiler';
import type { PipelineExecutor } from './PipelineExecutor';
import type { PipelineRunState } from './PipelineRunRegistry';
import { resolvePipelineStepText } from './PipelineStepCompletion';

export interface TeamReviewerSessionUpdate {
  sessionId: string;
  phase: string;
  update: SessionNotification;
  stepId?: string;
  branchId?: string;
  role?: TeamRoleId;
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
  private reviewerRerunAbortController: AbortController | null = null;

  constructor(private readonly dependencies: TeamRunSnapshotStoreDependencies) {}

  getLastTeamRunSnapshot(): TeamRunSnapshot | null {
    return this.lastTeamRunSnapshot;
  }

  cancelReviewerRerun(): void {
    this.reviewerRerunAbortController?.abort();
    this.reviewerRerunAbortController = null;
  }

  abortReviewerRerunOnDispose(): void {
    this.reviewerRerunAbortController?.abort();
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

    const entry = getTeamEntryForAgent(
      teamAgentName,
      this.dependencies.workspaceCwd(),
      this.dependencies.readAgentConfigs(),
    );
    if (!entry?.pipeline?.metadata) {
      throw new Error(`Team "${teamAgentName}" is not available.`);
    }

    const reviewerRole = entry.pipeline.metadata.agentByRole.reviewer;
    if (!reviewerRole) {
      throw new Error('Team has no reviewer role configured.');
    }

    const reviewerInstructions = entry.pipeline.metadata.instructionsByRole?.reviewer;
    if (!reviewerInstructions) {
      throw new Error('Team reviewer instructions are unavailable for re-run.');
    }

    const diff = await this.readWorkspaceDiff();
    const reviewerPrompt = buildReviewerRerunPrompt({
      reviewerInstructions,
      approvedPlan: snapshot.approvedPlan,
      implementOutput: snapshot.implementOutput,
      workspaceDiff: diff,
    });

    this.reviewerRerunAbortController?.abort();
    const abortController = new AbortController();
    this.reviewerRerunAbortController = abortController;

    try {
      const result = await this.dependencies.executor.runAgent(reviewerRole, reviewerPrompt, {
        signal: abortController.signal,
        onSessionUpdate: (update: SessionNotification) => {
          this.dependencies.emitSessionUpdate({
            sessionId: snapshot.sessionId,
            phase: 'reviewer-rerun',
            update,
            stepId: 'reviewer',
            role: 'reviewer',
            agentName: reviewerRole,
            teamId: snapshot.teamId,
          });
        },
      });
      return resolvePipelineStepText(result);
    } finally {
      if (this.reviewerRerunAbortController === abortController) {
        this.reviewerRerunAbortController = null;
      }
    }
  }

  private async readWorkspaceDiff(): Promise<string> {
    try {
      const result = await defaultGitCommandRunner.exec(this.dependencies.workspaceCwd(), ['diff', 'HEAD']);
      return result.stdout.trim();
    } catch {
      return '';
    }
  }
}
