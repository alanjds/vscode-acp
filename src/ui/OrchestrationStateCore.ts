export const ORCHESTRATION_STATE_KEY = 'acp.orchestrationWebviewState';

export interface OrchestrationPlanState {
  plan: string;
  status: string;
  message?: string;
  role?: string;
  agentName?: string;
  implementerUsesSandcastle?: boolean;
}

export interface OrchestrationRoleOutputState {
  role: string;
  agentName?: string;
  text: string;
  title: string;
}

export interface OrchestrationState {
  timeline: unknown[];
  activeRole: string | null;
  activeAgentName: string | null;
  plan: OrchestrationPlanState | null;
  roleOutputs: OrchestrationRoleOutputState[];
}

export function emptyOrchestrationState(): OrchestrationState {
  return {
    timeline: [],
    activeRole: null,
    activeAgentName: null,
    plan: null,
    roleOutputs: [],
  };
}

function normalizePlan(value: unknown): OrchestrationPlanState | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const candidate = value as Partial<OrchestrationPlanState>;
  if (typeof candidate.plan !== 'string' || typeof candidate.status !== 'string') {
    return null;
  }
  return {
    plan: candidate.plan,
    status: candidate.status,
    message: typeof candidate.message === 'string' ? candidate.message : undefined,
    role: typeof candidate.role === 'string' ? candidate.role : undefined,
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
    if (typeof candidate.text !== 'string' || typeof candidate.title !== 'string' || typeof candidate.role !== 'string') {
      return [];
    }
    return [{
      role: candidate.role,
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
    ? candidate.timeline
    : Array.isArray(candidate.pipelineTimeline)
      ? candidate.pipelineTimeline
      : [];

  const activeRole = typeof candidate.activeRole === 'string'
    ? candidate.activeRole
    : typeof candidate.activePipelineRole === 'string'
      ? candidate.activePipelineRole
      : null;

  const activeAgentName = typeof candidate.activeAgentName === 'string'
    ? candidate.activeAgentName
    : typeof candidate.activePipelineAgentName === 'string'
      ? candidate.activePipelineAgentName
      : null;

  return {
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
