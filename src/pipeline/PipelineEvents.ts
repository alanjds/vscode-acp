import type { SessionNotification } from '@agentclientprotocol/sdk';

import type { TeamRoleId } from '../config/AgentTeamConfig';

export type PipelineStatus =
  | 'planning'
  | 'awaiting_approval'
  | 'implementing'
  | 'reviewing'
  | 'testing'
  | 'completed'
  | 'rejected'
  | 'error'
  | 'cancelled';

export interface PipelineStatusEvent {
  sessionId: string;
  status: PipelineStatus;
  message: string;
  stepId?: string;
  branchId?: string;
  role?: TeamRoleId;
  agentName?: string;
  teamId?: string;
  implementerUsesSandcastle?: boolean;
}

export interface PipelinePlanReadyEvent {
  sessionId: string;
  plan: string;
  stepId: string;
  role?: TeamRoleId;
  agentName?: string;
  teamId?: string;
  implementerUsesSandcastle?: boolean;
  revised?: boolean;
}

export interface PipelineSessionUpdateEvent {
  sessionId: string;
  phase: string;
  update: SessionNotification;
  stepId?: string;
  branchId?: string;
  role?: TeamRoleId;
  agentName?: string;
  teamId?: string;
}

export type PipelineExecutorKind = string;
