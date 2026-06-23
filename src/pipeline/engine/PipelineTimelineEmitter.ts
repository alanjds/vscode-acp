import type { EventEmitter } from 'node:events';

import type { TeamRoleId } from '../../config/AgentTeamConfig';
import type { CompiledTeamMetadata } from '../AgentTeamCompiler';
import type { PipelinePlanReadyEvent, PipelineStatus } from '../PipelineEvents';

export interface PipelineTimelineEmitter {
  emitStatus(
    sessionId: string,
    status: PipelineStatus,
    message: string,
    stepId?: string,
    branchId?: string,
    teamContext?: CompiledTeamMetadata,
    role?: TeamRoleId,
    agentName?: string,
    implementerUsesSandcastle?: boolean,
  ): void;
  emitPlanReady(
    sessionId: string,
    event: PipelinePlanReadyEvent,
    approvalMessage: string,
    approvalStepId: string,
    teamContext?: CompiledTeamMetadata,
    implementerUsesSandcastle?: boolean,
  ): void;
}

export function createPipelineTimelineEmitter(emitter: EventEmitter): PipelineTimelineEmitter {
  return {
    emitStatus(
      sessionId,
      status,
      message,
      stepId,
      branchId,
      teamContext,
      role,
      agentName,
      implementerUsesSandcastle,
    ) {
      emitter.emit('status', {
        sessionId,
        status,
        message,
        stepId,
        branchId,
        role,
        agentName,
        teamId: teamContext?.teamId,
        implementerUsesSandcastle,
      });
    },

    emitPlanReady(
      sessionId,
      event,
      approvalMessage,
      approvalStepId,
      teamContext,
      implementerUsesSandcastle,
    ) {
      emitter.emit('plan-ready', event);
      emitter.emit('status', {
        sessionId,
        status: 'awaiting_approval',
        message: approvalMessage,
        stepId: approvalStepId,
        teamId: teamContext?.teamId,
        implementerUsesSandcastle,
      });
    },
  };
}
