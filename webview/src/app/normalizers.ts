import type {
  ChatHistoryItem,
  MarkdownRenderedItem,
  MessageHistoryItem,
  ModelOption,
  ModelsState,
  ModeOption,
  ModesState,
  PersistedWebviewState,
  PipelinePlanHistoryItem,
  PipelinePlanStatus,
  PipelineRoleOutputHistoryItem,
  PlanEntry,
  PlanHistoryItem,
  PlanUpdate,
  ConfigOptionGroup,
  ConfigOptionValue,
  ContextLinkedFrom,
  SessionSnapshot,
  SessionConfigOption,
  SessionUpdate,
  SlashCommand,
  ThoughtHistoryItem,
  ToolCallHistoryItem,
  ToolCallStatus,
} from '../chatTypes';
import { normalizePipelinePlanStatus as normalizeSharedPipelinePlanStatus } from '../../../src/ui/PipelineTypes';

export function normalizeModesState(value: unknown): ModesState | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const candidate = value as Partial<ModesState>;
  return {
    availableModes: Array.isArray(candidate.availableModes)
      ? candidate.availableModes
          .filter((mode): mode is ModeOption => Boolean(mode && typeof mode === 'object'))
          .map((mode) => ({
            id: String(mode.id ?? ''),
            name: String(mode.name ?? mode.id ?? 'Mode'),
            description: typeof mode.description === 'string' ? mode.description : undefined,
          }))
          .filter((mode) => mode.id.length > 0)
      : [],
    currentModeId:
      typeof candidate.currentModeId === 'string' ? candidate.currentModeId : candidate.currentModeId ?? null,
  };
}

export function normalizeModelsState(value: unknown): ModelsState | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const candidate = value as Partial<ModelsState>;
  return {
    availableModels: Array.isArray(candidate.availableModels)
      ? candidate.availableModels
          .filter((model): model is ModelOption => Boolean(model && typeof model === 'object'))
          .map((model) => ({
            modelId: String(model.modelId ?? ''),
            name: String(model.name ?? model.modelId ?? 'Model'),
            description: typeof model.description === 'string' ? model.description : undefined,
          }))
          .filter((model) => model.modelId.length > 0)
      : [],
    currentModelId:
      typeof candidate.currentModelId === 'string'
        ? candidate.currentModelId
        : candidate.currentModelId ?? null,
  };
}

export function normalizeSlashCommands(value: unknown): SlashCommand[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((command): command is SlashCommand => Boolean(command && typeof command === 'object'))
    .map((command) => ({
      name: String(command.name ?? ''),
      description: String(command.description ?? ''),
      input:
        command.input && typeof command.input === 'object'
          ? {
              hint: typeof command.input.hint === 'string' ? command.input.hint : undefined,
            }
          : undefined,
    }))
    .filter((command) => command.name.length > 0);
}

function normalizeConfigOptionValue(value: unknown): ConfigOptionValue | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const candidate = value as Partial<ConfigOptionValue>;
  const optionValue = typeof candidate.value === 'string' ? candidate.value : '';
  if (!optionValue) {
    return null;
  }

  return {
    value: optionValue,
    name: typeof candidate.name === 'string' ? candidate.name : undefined,
    description: typeof candidate.description === 'string' ? candidate.description : undefined,
  };
}

function normalizeConfigOptionGroup(value: unknown): ConfigOptionGroup | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const candidate = value as Partial<ConfigOptionGroup>;
  const options = Array.isArray(candidate.options)
    ? candidate.options
        .map(normalizeConfigOptionValue)
        .filter((option): option is ConfigOptionValue => option !== null)
    : [];
  if (options.length === 0) {
    return null;
  }

  return {
    group: typeof candidate.group === 'string' ? candidate.group : undefined,
    name: typeof candidate.name === 'string' ? candidate.name : undefined,
    options,
  };
}

export function normalizeConfigOptions(value: unknown): SessionConfigOption[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((option): option is Record<string, unknown> => Boolean(option && typeof option === 'object'))
    .map((option) => {
      const rawOptions = Array.isArray(option.options) ? option.options : [];
      const options = rawOptions
        .map((entry) => normalizeConfigOptionGroup(entry) ?? normalizeConfigOptionValue(entry))
        .filter((entry): entry is ConfigOptionGroup | ConfigOptionValue => entry !== null);

      return {
        id: typeof option.id === 'string' ? option.id : '',
        name: typeof option.name === 'string' ? option.name : undefined,
        description: typeof option.description === 'string' ? option.description : undefined,
        type: typeof option.type === 'string' ? option.type : undefined,
        category: typeof option.category === 'string' ? option.category : undefined,
        currentValue: typeof option.currentValue === 'string' ? option.currentValue : option.currentValue === null ? null : undefined,
        options,
      };
    })
    .filter((option) => option.id.length > 0);
}

function normalizeContextLinkedFrom(value: unknown): ContextLinkedFrom | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }
  const candidate = value as Record<string, unknown>;
  const agentName = typeof candidate.agentName === 'string' ? candidate.agentName : '';
  const sessionId = typeof candidate.sessionId === 'string' ? candidate.sessionId : '';
  const createdAt = typeof candidate.createdAt === 'string' ? candidate.createdAt : '';
  if (!agentName || !sessionId || !createdAt) {
    return undefined;
  }
  return { agentName, sessionId, createdAt };
}

function normalizeContextFamily(value: unknown): SessionSnapshot['contextFamily'] {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const candidate = value as Record<string, unknown>;
  const contextFamilyId = typeof candidate.contextFamilyId === 'string' ? candidate.contextFamilyId : '';
  if (!contextFamilyId) {
    return null;
  }
  return {
    contextFamilyId,
    contextLinkedFrom: normalizeContextLinkedFrom(candidate.contextLinkedFrom),
    contextLinkedAt: typeof candidate.contextLinkedAt === 'string' ? candidate.contextLinkedAt : undefined,
  };
}

export function normalizeSessionSnapshot(value: unknown): SessionSnapshot | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const candidate = value as Partial<SessionSnapshot>;
  return {
    sessionId: typeof candidate.sessionId === 'string' ? candidate.sessionId : undefined,
    agentName: typeof candidate.agentName === 'string' ? candidate.agentName : undefined,
    title: typeof candidate.title === 'string' ? candidate.title : undefined,
    cwd: typeof candidate.cwd === 'string' ? candidate.cwd : undefined,
    modes: normalizeModesState(candidate.modes),
    models: normalizeModelsState(candidate.models),
    configOptions: normalizeConfigOptions(candidate.configOptions),
    availableCommands: normalizeSlashCommands(candidate.availableCommands),
    contextFamily: normalizeContextFamily(candidate.contextFamily),
    pendingSharedContext: candidate.pendingSharedContext === true,
  };
}

export function normalizePlanEntry(entry: unknown): PlanEntry | null {
  if (!entry || typeof entry !== 'object') {
    return null;
  }

  const candidate = entry as Partial<PlanEntry>;
  return {
    status: typeof candidate.status === 'string' ? candidate.status : undefined,
    title: typeof candidate.title === 'string' ? candidate.title : undefined,
    description: typeof candidate.description === 'string' ? candidate.description : undefined,
    content: typeof candidate.content === 'string' ? candidate.content : undefined,
  };
}

export function normalizePlanUpdate(value: unknown): PlanUpdate {
  const candidate = value && typeof value === 'object' ? (value as PlanUpdate) : {};
  return {
    ...candidate,
    sessionUpdate: 'plan',
    entries: Array.isArray(candidate.entries)
      ? candidate.entries.map(normalizePlanEntry).filter((entry): entry is PlanEntry => entry !== null)
      : [],
  };
}

function normalizePipelinePlanStatus(value: unknown): PipelinePlanStatus {
  return normalizeSharedPipelinePlanStatus(value) ?? 'pending';
}

export function normalizeMarkdownRenderedItems(value: unknown): MarkdownRenderedItem[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object'))
    .map((item) => ({
      index: typeof item.index === 'number' ? item.index : -1,
      html: typeof item.html === 'string' ? item.html : '',
    }))
    .filter((item) => item.index >= 0);
}

export function normalizeSessionUpdate(value: unknown): SessionUpdate {
  if (!value || typeof value !== 'object') {
    return { sessionUpdate: 'unknown' };
  }

  const candidate = value as Record<string, unknown>;
  const sessionUpdate = typeof candidate.sessionUpdate === 'string' ? candidate.sessionUpdate : 'unknown';

  switch (sessionUpdate) {
    case 'agent_message_chunk':
    case 'user_message_chunk':
    case 'agent_thought_chunk': {
      const content =
        candidate.content && typeof candidate.content === 'object'
          ? (candidate.content as Record<string, unknown>)
          : null;
      return {
        sessionUpdate,
        content: content
          ? {
              type: typeof content.type === 'string' ? content.type : undefined,
              text: typeof content.text === 'string' ? content.text : undefined,
            }
          : undefined,
      };
    }

    case 'tool_call':
    case 'tool_call_update':
      return {
        sessionUpdate,
        toolCallId: typeof candidate.toolCallId === 'string' ? candidate.toolCallId : undefined,
        title: typeof candidate.title === 'string' ? candidate.title : undefined,
        status: normalizeToolCallStatus(candidate.status),
      };

    case 'plan':
      return normalizePlanUpdate(candidate);

    case 'current_mode_update':
      return {
        sessionUpdate,
        currentModeId: typeof candidate.currentModeId === 'string' ? candidate.currentModeId : null,
        modeId: typeof candidate.modeId === 'string' ? candidate.modeId : null,
      };

    case 'available_commands_update':
      return {
        sessionUpdate,
        availableCommands: normalizeSlashCommands(candidate.availableCommands),
      };

    case 'config_option_update':
      return {
        sessionUpdate,
        configOptions: normalizeConfigOptions(candidate.configOptions),
      };

    default:
      return {
        sessionUpdate,
        ...candidate,
      };
  }
}

export function normalizeMessageHistoryItem(value: unknown): MessageHistoryItem | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const candidate = value as Partial<MessageHistoryItem>;
  if (candidate.kind !== 'message') {
    return null;
  }

  const role = candidate.role;
  if (role !== 'user' && role !== 'assistant' && role !== 'error' && role !== 'info') {
    return null;
  }

  return {
    kind: 'message',
    role,
    text: String(candidate.text ?? ''),
    turnId: typeof candidate.turnId === 'string' ? candidate.turnId : undefined,
  };
}

export function normalizePipelinePlanHistoryItem(value: unknown): PipelinePlanHistoryItem | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const candidate = value as Partial<PipelinePlanHistoryItem>;
  if (candidate.kind !== 'pipelinePlan' || typeof candidate.plan !== 'string') {
    return null;
  }

  return {
    kind: 'pipelinePlan',
    plan: candidate.plan,
    status: normalizePipelinePlanStatus(candidate.status),
    message: typeof candidate.message === 'string' ? candidate.message : undefined,
    role: candidate.role === 'planner' || candidate.role === 'implementer' || candidate.role === 'reviewer' || candidate.role === 'tester' || candidate.role === 'reviewer-rerun'
      ? candidate.role
      : undefined,
    agentName: typeof candidate.agentName === 'string' ? candidate.agentName : undefined,
    implementerUsesSandcastle: candidate.implementerUsesSandcastle === true ? true : undefined,
  };
}

export function normalizePipelineRoleOutputHistoryItem(value: unknown): PipelineRoleOutputHistoryItem | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const candidate = value as Partial<PipelineRoleOutputHistoryItem>;
  if (candidate.kind !== 'pipelineRoleOutput' || typeof candidate.text !== 'string') {
    return null;
  }

  const role = candidate.role;
  if (role !== 'planner' && role !== 'implementer' && role !== 'reviewer' && role !== 'tester' && role !== 'reviewer-rerun') {
    return null;
  }

  return {
    kind: 'pipelineRoleOutput',
    role,
    agentName: typeof candidate.agentName === 'string' ? candidate.agentName : undefined,
    text: candidate.text,
    title: typeof candidate.title === 'string' ? candidate.title : role,
  };
}

export function normalizeThoughtHistoryItem(value: unknown): ThoughtHistoryItem | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const candidate = value as Partial<ThoughtHistoryItem>;
  if (candidate.kind !== 'thought') {
    return null;
  }

  return {
    kind: 'thought',
    text: String(candidate.text ?? ''),
    durationSec: typeof candidate.durationSec === 'number' ? candidate.durationSec : 0,
    turnId: typeof candidate.turnId === 'string' ? candidate.turnId : undefined,
  };
}

export function normalizeToolCallHistoryItem(value: unknown): ToolCallHistoryItem | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const candidate = value as Partial<ToolCallHistoryItem>;
  if (candidate.kind !== 'toolCall') {
    return null;
  }

  return {
    kind: 'toolCall',
    toolCallId: String(candidate.toolCallId ?? 'unknown'),
    title: String(candidate.title ?? 'Tool Call'),
    status: normalizeToolCallStatus(candidate.status),
    turnId: typeof candidate.turnId === 'string' ? candidate.turnId : undefined,
  };
}

export function normalizePlanHistoryItem(value: unknown): PlanHistoryItem | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const candidate = value as Partial<PlanHistoryItem>;
  if (candidate.kind !== 'plan') {
    return null;
  }

  return {
    kind: 'plan',
    plan: normalizePlanUpdate(candidate.plan),
  };
}

export function normalizeChatHistoryItem(value: unknown): ChatHistoryItem | null {
  return (
    normalizeMessageHistoryItem(value) ??
    normalizeThoughtHistoryItem(value) ??
    normalizeToolCallHistoryItem(value) ??
    normalizePlanHistoryItem(value) ??
    normalizePipelinePlanHistoryItem(value) ??
    normalizePipelineRoleOutputHistoryItem(value)
  );
}

export function normalizePersistedState(value: unknown): PersistedWebviewState {
  if (!value || typeof value !== 'object') {
    return {
      chatHistory: [],
      sessionState: null,
      hasActiveSession: false,
    };
  }

  const candidate = value as Partial<PersistedWebviewState>;
  return {
    chatHistory: Array.isArray(candidate.chatHistory)
      ? candidate.chatHistory
          .map(normalizeChatHistoryItem)
          .filter((item): item is ChatHistoryItem => item !== null)
      : [],
    sessionState: normalizeSessionSnapshot(candidate.sessionState),
    hasActiveSession: Boolean(candidate.hasActiveSession),
  };
}

export function normalizeToolCallStatus(status: unknown): ToolCallStatus {
  switch (status) {
    case 'running':
    case 'completed':
    case 'failed':
      return status;
    default:
      return 'pending';
  }
}
