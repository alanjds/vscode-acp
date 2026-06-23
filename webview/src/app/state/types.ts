import type {
  ChatWebviewSharedState,
  CurrentTurn,
  ModelsState,
  ModesState,
  PersistedWebviewState,
  PipelinePhase,
  PipelinePlanStatus,
  PipelineTimelineStep,
  PlanUpdate,
  SessionConfigOption,
  SessionSnapshot,
  SlashCommand,
  ToolCallStatus,
} from '../../chatTypes';
import type { OrchestrationSlice } from '../OrchestrationProjector';

export type AppState = {
  persisted: PersistedWebviewState;
  orchestration: OrchestrationSlice;
  promptText: string;
  inputAreaHeight: number;
  isProcessing: boolean;
  composerUnlocked: boolean;
  isModeDropdownOpen: boolean;
  isModelDropdownOpen: boolean;
  openConfigDropdownId: string | null;
  slashSelectedIdx: number;
  slashPopupSuppressedFor: string | null;
  placeholderOverride: string | null;
  renderedMarkdown: Record<number, string>;
  currentTurn: CurrentTurn | null;
  collapsedTools: Record<string, boolean>;
  isLoadingSession: boolean;
};

export type AppAction =
  | { type: 'setPromptText'; text: string }
  | { type: 'setInputAreaHeight'; height: number }
  | { type: 'toggleModeDropdown' }
  | { type: 'toggleModelDropdown' }
  | { type: 'toggleConfigDropdown'; configId: string }
  | { type: 'closePickers' }
  | { type: 'setSlashSelectedIdx'; index: number }
  | { type: 'suppressSlashPopup'; promptText: string | null }
  | { type: 'setPlaceholderOverride'; placeholder: string | null }
  | { type: 'setCollapsedTools'; key: string; collapsed: boolean }
  | { type: 'showSessionConnected'; session: SessionSnapshot }
  | { type: 'showNoSession' }
  | { type: 'appendUserMessage'; text: string }
  | { type: 'submitUserMessage'; text: string }
  | { type: 'appendUserChunk'; text: string }
  | { type: 'appendErrorMessage'; text: string }
  | { type: 'appendInfoMessage'; text: string }
  | { type: 'promptStart'; turnId: string }
  | { type: 'promptEnd' }
  | { type: 'clearChat' }
  | { type: 'updateModes'; modes: ModesState }
  | { type: 'updateModels'; models: ModelsState }
  | { type: 'updateConfigOptions'; configOptions: SessionConfigOption[] }
  | { type: 'updateSessionTitle'; title: string | null }
  | { type: 'updateCurrentMode'; modeId: string | null }
  | { type: 'updateCurrentModel'; modelId: string | null }
  | { type: 'updateAvailableCommands'; commands: SlashCommand[] }
  | { type: 'appendThoughtChunk'; text: string }
  | { type: 'setCurrentThoughtOpen'; isOpen: boolean }
  | { type: 'appendAssistantChunk'; text: string }
  | { type: 'appendPlanningDraftChunk'; text: string }
  | { type: 'appendToolCall'; toolCallId: string; title: string; status: ToolCallStatus }
  | { type: 'updateToolCall'; toolCallId: string; title?: string; status: ToolCallStatus }
  | { type: 'appendPlan'; plan: PlanUpdate }
  | { type: 'appendPipelinePlan'; plan: string; role?: PipelinePhase; agentName?: string; implementerUsesSandcastle?: boolean }
  | { type: 'revisePipelinePlan'; plan: string; role?: PipelinePhase; agentName?: string; implementerUsesSandcastle?: boolean }
  | { type: 'updatePipelinePlanStatus'; status: PipelinePlanStatus; message?: string }
  | { type: 'revertPipelinePlanApproval' }
  | { type: 'updatePipelineTimeline'; timeline: PipelineTimelineStep[] }
  | { type: 'setActivePipelineRole'; role: PipelinePhase | null; agentName?: string | null }
  | { type: 'appendPipelineRoleOutput'; role: PipelinePhase; agentName?: string; text: string; title: string }
  | { type: 'finalizeTeamRoleTurn' }
  | { type: 'loadSessionStart' }
  | { type: 'loadSessionEnd'; ok: boolean }
  | { type: 'setRenderedMarkdown'; items: Array<{ index: number; html: string }> }
  | { type: 'hydrateSharedState'; state: ChatWebviewSharedState }
  | { type: 'hydrateOrchestrationState'; state: OrchestrationSlice };

export type ComposerAction = Extract<
  AppAction,
  | { type: 'setPromptText' }
  | { type: 'setInputAreaHeight' }
  | { type: 'toggleModeDropdown' }
  | { type: 'toggleModelDropdown' }
  | { type: 'toggleConfigDropdown' }
  | { type: 'closePickers' }
  | { type: 'setSlashSelectedIdx' }
  | { type: 'suppressSlashPopup' }
  | { type: 'setPlaceholderOverride' }
  | { type: 'setCollapsedTools' }
>;

export type SessionAction = Extract<
  AppAction,
  | { type: 'showSessionConnected' }
  | { type: 'showNoSession' }
  | { type: 'updateModes' }
  | { type: 'updateModels' }
  | { type: 'updateConfigOptions' }
  | { type: 'updateSessionTitle' }
  | { type: 'updateCurrentMode' }
  | { type: 'updateCurrentModel' }
  | { type: 'updateAvailableCommands' }
  | { type: 'loadSessionStart' }
  | { type: 'loadSessionEnd' }
  | { type: 'hydrateSharedState' }
  | { type: 'hydrateOrchestrationState' }
>;

export type ChatAction = Extract<
  AppAction,
  | { type: 'appendUserMessage' }
  | { type: 'submitUserMessage' }
  | { type: 'appendUserChunk' }
  | { type: 'appendErrorMessage' }
  | { type: 'appendInfoMessage' }
  | { type: 'promptStart' }
  | { type: 'promptEnd' }
  | { type: 'appendThoughtChunk' }
  | { type: 'setCurrentThoughtOpen' }
  | { type: 'appendAssistantChunk' }
  | { type: 'appendPlanningDraftChunk' }
  | { type: 'appendToolCall' }
  | { type: 'updateToolCall' }
  | { type: 'appendPlan' }
  | { type: 'setRenderedMarkdown' }
>;

export type PipelineAction = Extract<
  AppAction,
  | { type: 'appendPipelinePlan' }
  | { type: 'revisePipelinePlan' }
  | { type: 'updatePipelinePlanStatus' }
  | { type: 'revertPipelinePlanApproval' }
  | { type: 'updatePipelineTimeline' }
  | { type: 'setActivePipelineRole' }
  | { type: 'appendPipelineRoleOutput' }
  | { type: 'resetPipelineTimeline' }
  | { type: 'finalizeTeamRoleTurn' }
>;
