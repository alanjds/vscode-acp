import {
  normalizePipelinePhase,
  normalizePipelinePlanStatus,
  normalizePipelineTimeline,
  type PipelinePhase,
  type PipelinePlanStatus,
  type PipelineTimelineStep,
} from './PipelineTypes';

export const ORCHESTRATION_STATE_KEY = 'acp.orchestrationWebviewState';

export interface OrchestrationPlanState {
  plan: string;
  status: PipelinePlanStatus;
  message?: string;
  role?: PipelinePhase;
  agentName?: string;
  implementerUsesSandcastle?: boolean;
}

export interface OrchestrationRoleOutputState {
  role: PipelinePhase;
  agentName?: string;
  text: string;
  title: string;
}

export interface OrchestrationState {
  version: number;
  updatedAt: number;
  timeline: PipelineTimelineStep[];
  activeRole: PipelinePhase | null;
  activeAgentName: string | null;
  plan: OrchestrationPlanState | null;
  roleOutputs: OrchestrationRoleOutputState[];
}

export function emptyOrchestrationState(): OrchestrationState {
  return {
    version: 0,
    updatedAt: 0,
    timeline: [],
    activeRole: null,
    activeAgentName: null,
    plan: null,
    roleOutputs: [],
  };
}

export function cloneOrchestrationState(state: OrchestrationState): OrchestrationState {
  return {
    version: state.version,
    updatedAt: state.updatedAt,
    timeline: state.timeline.map(step => ({ ...step })),
    activeRole: state.activeRole,
    activeAgentName: state.activeAgentName,
    plan: state.plan ? { ...state.plan } : null,
    roleOutputs: state.roleOutputs.map(output => ({ ...output })),
  };
}

export function shouldAcceptIncomingOrchestrationState(
  current: Pick<OrchestrationState, 'version' | 'updatedAt'>,
  incoming: Pick<OrchestrationState, 'version' | 'updatedAt'>,
): boolean {
  return incoming.version > current.version
    || (incoming.version === current.version && incoming.updatedAt > current.updatedAt);
}

export function buildOrchestrationSnapshot(
  parts: Omit<OrchestrationState, 'version' | 'updatedAt'>,
  version: number,
  updatedAt: number,
): OrchestrationState {
  return normalizeOrchestrationState({
    ...parts,
    version,
    updatedAt,
  });
}

function normalizePlan(value: unknown): OrchestrationPlanState | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const candidate = value as Partial<OrchestrationPlanState>;
  if (typeof candidate.plan !== 'string') {
    return null;
  }
  const status = normalizePipelinePlanStatus(candidate.status);
  if (!status) {
    return null;
  }
  return {
    plan: candidate.plan,
    status,
    message: typeof candidate.message === 'string' ? candidate.message : undefined,
    role: normalizePipelinePhase(candidate.role) ?? undefined,
    agentName: typeof candidate.agentName === 'string' ? candidate.agentName : undefined,
    implementerUsesSandcastle: candidate.implementerUsesSandcastle === true,
  };
}

function normalizeRoleOutputs(value: unknown): OrchestrationRoleOutputState[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap(entry => {
    if (!entry || typeof entry !== 'object') {
      return [];
    }
    const candidate = entry as Partial<OrchestrationRoleOutputState>;
    const role = normalizePipelinePhase(candidate.role);
    if (!role || typeof candidate.text !== 'string' || typeof candidate.title !== 'string') {
      return [];
    }
    return [{
      role,
      agentName: typeof candidate.agentName === 'string' ? candidate.agentName : undefined,
      text: candidate.text,
      title: candidate.title,
    }];
  });
}

export function normalizeOrchestrationState(value: unknown): OrchestrationState {
  if (!value || typeof value !== 'object') {
    return emptyOrchestrationState();
  }

  const candidate = value as Partial<OrchestrationState> & {
    pipelineTimeline?: unknown[];
    activePipelineRole?: string | null;
    activePipelineAgentName?: string | null;
  };

  const timeline = Array.isArray(candidate.timeline)
    ? normalizePipelineTimeline(candidate.timeline)
    : Array.isArray(candidate.pipelineTimeline)
      ? normalizePipelineTimeline(candidate.pipelineTimeline)
      : [];

  const activeRole = normalizePipelinePhase(candidate.activeRole)
    ?? normalizePipelinePhase(candidate.activePipelineRole);

  const activeAgentName = typeof candidate.activeAgentName === 'string'
    ? candidate.activeAgentName
    : typeof candidate.activePipelineAgentName === 'string'
      ? candidate.activePipelineAgentName
      : null;

  return {
    version: typeof candidate.version === 'number' ? candidate.version : 0,
    updatedAt: typeof candidate.updatedAt === 'number' ? candidate.updatedAt : 0,
    timeline,
    activeRole,
    activeAgentName,
    plan: normalizePlan(candidate.plan),
    roleOutputs: normalizeRoleOutputs(candidate.roleOutputs),
  };
}

/** Reads pipeline fields from a legacy ChatWebviewSharedState blob before they were split out. */
export function extractLegacyOrchestrationFromShared(value: unknown): OrchestrationState {
  if (!value || typeof value !== 'object') {
    return emptyOrchestrationState();
  }

  const candidate = value as {
    pipelineTimeline?: unknown[];
    activePipelineRole?: string | null;
    activePipelineAgentName?: string | null;
    orchestration?: unknown;
    shared?: unknown;
  };

  if (candidate.orchestration) {
    return normalizeOrchestrationState(candidate.orchestration);
  }

  if (candidate.shared) {
    return extractLegacyOrchestrationFromShared(candidate.shared);
  }

  return normalizeOrchestrationState({
    timeline: candidate.pipelineTimeline,
    activeRole: candidate.activePipelineRole,
    activeAgentName: candidate.activePipelineAgentName,
  });
}

export interface WebviewSerializerState {
  shared?: unknown;
  orchestration?: unknown;
}

export function normalizeWebviewSerializerState(value: unknown): WebviewSerializerState {
  if (!value || typeof value !== 'object') {
    return {};
  }

  const candidate = value as WebviewSerializerState & {
    version?: number;
    chatHistory?: unknown[];
  };

  if (candidate.shared || candidate.orchestration) {
    return {
      shared: candidate.shared,
      orchestration: candidate.orchestration,
    };
  }

  if (typeof candidate.version === 'number' || Array.isArray(candidate.chatHistory)) {
    return { shared: value };
  }

  return {};
}

export type { PipelinePhase, PipelinePlanStatus, PipelineTimelineStep } from './PipelineTypes';
export { normalizePipelinePhase } from './PipelineTypes';
