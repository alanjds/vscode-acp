export const ORCHESTRATION_STATE_KEY = 'acp.orchestrationWebviewState';

export interface OrchestrationState {
  timeline: unknown[];
  activeRole: string | null;
  activeAgentName: string | null;
}

export function emptyOrchestrationState(): OrchestrationState {
  return {
    timeline: [],
    activeRole: null,
    activeAgentName: null,
  };
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

  return { timeline, activeRole, activeAgentName };
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
