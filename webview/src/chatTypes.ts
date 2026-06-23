export type ChatRole = 'user' | 'assistant' | 'error' | 'info';

export type ToolCallStatus = 'pending' | 'running' | 'completed' | 'failed';

export type PlanEntryStatus = 'completed' | 'in_progress' | 'pending' | string;

export type MarkdownRenderItem = {
  index: number;
  text: string;
};

export type MarkdownRenderedItem = {
  index: number;
  html: string;
};

export type ModeOption = {
  id: string;
  name: string;
  description?: string;
};

export type ModesState = {
  availableModes: ModeOption[];
  currentModeId?: string | null;
};

export type ModelOption = {
  modelId: string;
  name: string;
  description?: string;
};

export type ModelsState = {
  availableModels: ModelOption[];
  currentModelId?: string | null;
};

export type SlashCommandInput = {
  hint?: string;
};

export type SlashCommand = {
  name: string;
  description: string;
  input?: SlashCommandInput | null;
};

export type ConfigOptionValue = {
  value: string;
  name?: string;
  description?: string;
};

export type ConfigOptionGroup = {
  group?: string;
  name?: string;
  options: ConfigOptionValue[];
};

export type SessionConfigOption = {
  id: string;
  name?: string;
  description?: string;
  type?: string;
  category?: string;
  currentValue?: string | null;
  options?: Array<ConfigOptionValue | ConfigOptionGroup>;
};

export type ContextLinkedFrom = {
  agentName: string;
  sessionId: string;
  createdAt: string;
};

export type ContextFamilySnapshot = {
  contextFamilyId: string;
  contextLinkedFrom?: ContextLinkedFrom;
  contextLinkedAt?: string;
};

export type SessionSnapshot = {
  sessionId?: string;
  agentName?: string;
  title?: string;
  cwd?: string;
  modes?: ModesState | null;
  models?: ModelsState | null;
  configOptions?: SessionConfigOption[] | null;
  availableCommands?: SlashCommand[] | null;
  contextFamily?: ContextFamilySnapshot | null;
  pendingSharedContext?: boolean;
};

export type MessageHistoryItem = {
  kind: 'message';
  role: ChatRole;
  text: string;
  turnId?: string;
};

export type ThoughtHistoryItem = {
  kind: 'thought';
  text: string;
  durationSec: number;
  turnId?: string;
};

export type ToolCallHistoryItem = {
  kind: 'toolCall';
  toolCallId: string;
  title: string;
  status: ToolCallStatus;
  turnId?: string;
};

export type PlanEntry = {
  status?: PlanEntryStatus;
  title?: string;
  description?: string;
  content?: string;
};

export type PlanUpdate = {
  sessionUpdate?: 'plan';
  entries?: PlanEntry[];
  [key: string]: unknown;
};

export type PlanHistoryItem = {
  kind: 'plan';
  plan: PlanUpdate;
};

import type {
  PipelinePlanStatus,
  PipelinePhase,
  PipelineTimelineStep,
  PipelineTimelineStepStatus,
} from '../../src/ui/PipelineTypes';

export type {
  PipelinePlanStatus,
  PipelinePhase,
  PipelineTimelineStep,
  PipelineTimelineStepStatus,
};

export type PipelinePlanHistoryItem = {
  kind: 'pipelinePlan';
  plan: string;
  status: PipelinePlanStatus;
  message?: string;
  role?: PipelinePhase;
  agentName?: string;
  implementerUsesSandcastle?: boolean;
};

export type PipelineRoleOutputHistoryItem = {
  kind: 'pipelineRoleOutput';
  role: PipelinePhase;
  agentName?: string;
  text: string;
  title: string;
};

export type ChatHistoryItem =
  | MessageHistoryItem
  | ThoughtHistoryItem
  | ToolCallHistoryItem
  | PlanHistoryItem
  | PipelinePlanHistoryItem
  | PipelineRoleOutputHistoryItem;

export type PersistedWebviewState = {
  chatHistory: ChatHistoryItem[];
  sessionState: SessionSnapshot | null;
  hasActiveSession: boolean;
};

export type ChatWebviewSharedState = {
  version: number;
  updatedAt: number;
  chatHistory: ChatHistoryItem[];
  sessionState: SessionSnapshot | null;
  hasActiveSession: boolean;
  promptText: string;
  inputAreaHeight: number;
  isProcessing: boolean;
  currentTurn: CurrentTurn | null;
  collapsedTools: Record<string, boolean>;
  composerUnlocked?: boolean;
};

export type FileSearchResult = {
  path: string;
  name: string;
};

export type SelectedFileMention = FileSearchResult & {
  token: string;
};

export type SessionContentChunk = {
  type?: string;
  text?: string;
};

export type AgentMessageChunkUpdate = {
  sessionUpdate: 'agent_message_chunk';
  content?: SessionContentChunk;
};

export type UserMessageChunkUpdate = {
  sessionUpdate: 'user_message_chunk';
  content?: SessionContentChunk;
};

export type AgentThoughtChunkUpdate = {
  sessionUpdate: 'agent_thought_chunk';
  content?: SessionContentChunk;
};

export type ToolCallUpdate = {
  sessionUpdate: 'tool_call';
  toolCallId?: string;
  title?: string;
  status?: ToolCallStatus;
};

export type ToolCallStatusUpdate = {
  sessionUpdate: 'tool_call_update';
  toolCallId?: string;
  title?: string;
  status?: ToolCallStatus;
};

export type CurrentModeUpdate = {
  sessionUpdate: 'current_mode_update';
  currentModeId?: string | null;
  modeId?: string | null;
};

export type AvailableCommandsUpdate = {
  sessionUpdate: 'available_commands_update';
  availableCommands?: SlashCommand[];
};

export type ConfigOptionUpdate = {
  sessionUpdate: 'config_option_update';
  configOptions?: SessionConfigOption[];
};

export type SessionUpdate =
  | AgentMessageChunkUpdate
  | UserMessageChunkUpdate
  | AgentThoughtChunkUpdate
  | ToolCallUpdate
  | ToolCallStatusUpdate
  | PlanUpdate
  | CurrentModeUpdate
  | AvailableCommandsUpdate
  | ConfigOptionUpdate
  | {
      sessionUpdate: string;
      [key: string]: unknown;
    };

export type CurrentThought = {
  text: string;
  startedAt: number | null;
  finishedAt: number | null;
  isOpen: boolean;
};

export type CurrentToolCall = {
  toolCallId: string;
  title: string;
  status: ToolCallStatus;
};

export type CurrentTurn = {
  turnId: string;
  assistantText: string;
  planningDraft: string;
  thought: CurrentThought | null;
  toolCalls: CurrentToolCall[];
  historyToolCallIndexes: number[];
};

export type DebugEventCategory =
  | 'traffic'
  | 'session-update'
  | 'prompt'
  | 'client-request'
  | 'client-response'
  | 'client-error'
  | 'lifecycle';

export type DebugEventDirection = 'send' | 'recv';

export type DebugEvent = {
  id: number;
  timestamp: string;
  category: DebugEventCategory | string;
  direction?: DebugEventDirection;
  agentId?: string;
  sessionId?: string;
  method?: string;
  status?: string;
  durationMs?: number;
  payload?: unknown;
  payloadSizeBytes: number;
};

export type DebugTraceSnapshot = {
  version: 1;
  startedAt: string;
  capturedAt: string;
  events: DebugEvent[];
  eventCount: number;
  droppedEvents: number;
  maxEvents: number;
  maxBytes: number;
  totalBytes: number;
};

export type DebugSnapshot = {
  version: 1;
  generatedAt: string;
  extension: {
    version: string;
  };
  activeSession: Record<string, unknown> | null;
  trace: DebugTraceSnapshot;
  chatState: unknown;
};
