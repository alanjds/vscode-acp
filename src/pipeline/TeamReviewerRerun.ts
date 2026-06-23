import type { SessionNotification } from '@agentclientprotocol/sdk';

import { getTeamEntryForAgent } from '../config/AgentTeamCatalog';
import type { TeamRoleId } from '../config/AgentTeamConfig';
import { defaultGitCommandRunner } from '../git/GitCommandRunner';
import { buildReviewerRerunPrompt } from './AgentTeamCompiler';
import type { PipelineExecutor } from './PipelineExecutor';
import { resolvePipelineStepText } from './PipelineStepCompletion';
import type { TeamRunSnapshot } from './TeamRunSnapshotStore';

export interface TeamReviewerRerunDependencies {
  workspaceCwd: () => string;
  readAgentConfigs: () => Record<string, unknown>;
  executor: PipelineExecutor;
  emitSessionUpdate: (event: {
    sessionId: string;
    phase: string;
    update: SessionNotification;
    stepId?: string;
    role?: TeamRoleId;
    agentName?: string;
    teamId?: string;
  }) => void;
}

export class TeamReviewerRerun {
  private abortController: AbortController | null = null;

  constructor(private readonly dependencies: TeamReviewerRerunDependencies) {}

  cancel(): void {
    this.abortController?.abort();
    this.abortController = null;
  }

  abortOnDispose(): void {
    this.abortController?.abort();
  }

  async rerun(snapshot: TeamRunSnapshot, teamAgentName: string): Promise<string> {
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

    this.abortController?.abort();
    const abortController = new AbortController();
    this.abortController = abortController;

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
      if (this.abortController === abortController) {
        this.abortController = null;
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
