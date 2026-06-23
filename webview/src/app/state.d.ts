import type { ChatWebviewSharedState, CurrentTurn, ModelsState, ModesState, PersistedWebviewState, PipelinePlanStatus, PipelinePhase, PipelineTimelineStep, PlanUpdate, SessionConfigOption, SessionSnapshot, SlashCommand, ToolCallStatus } from '../chatTypes';
export declare const MIN_INPUT_HEIGHT = 90;
export declare const MAX_INPUT_HEIGHT = 400;
export declare const DEFAULT_INPUT_HEIGHT = 140;
export type AppState = {
    persisted: PersistedWebviewState;
    orchestration: {
        timeline: PipelineTimelineStep[];
        activeRole: PipelinePhase | null;
        activeAgentName: string | null;
    };
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
export type AppAction = {
    type: 'setPromptText';
    text: string;
} | {
    type: 'setInputAreaHeight';
    height: number;
} | {
    type: 'toggleModeDropdown';
} | {
    type: 'toggleModelDropdown';
} | {
    type: 'toggleConfigDropdown';
    configId: string;
} | {
    type: 'closePickers';
} | {
    type: 'setSlashSelectedIdx';
    index: number;
} | {
    type: 'suppressSlashPopup';
    promptText: string | null;
} | {
    type: 'setPlaceholderOverride';
    placeholder: string | null;
} | {
    type: 'setCollapsedTools';
    key: string;
    collapsed: boolean;
} | {
    type: 'showSessionConnected';
    session: SessionSnapshot;
} | {
    type: 'showNoSession';
} | {
    type: 'appendUserMessage';
    text: string;
} | {
    type: 'submitUserMessage';
    text: string;
} | {
    type: 'appendUserChunk';
    text: string;
} | {
    type: 'appendErrorMessage';
    text: string;
} | {
    type: 'appendInfoMessage';
    text: string;
} | {
    type: 'promptStart';
    turnId: string;
} | {
    type: 'promptEnd';
} | {
    type: 'clearChat';
} | {
    type: 'updateModes';
    modes: ModesState;
} | {
    type: 'updateModels';
    models: ModelsState;
} | {
    type: 'updateConfigOptions';
    configOptions: SessionConfigOption[];
} | {
    type: 'updateSessionTitle';
    title: string | null;
} | {
    type: 'updateCurrentMode';
    modeId: string | null;
} | {
    type: 'updateCurrentModel';
    modelId: string | null;
} | {
    type: 'updateAvailableCommands';
    commands: SlashCommand[];
} | {
    type: 'appendThoughtChunk';
    text: string;
} | {
    type: 'setCurrentThoughtOpen';
    isOpen: boolean;
} | {
    type: 'appendAssistantChunk';
    text: string;
} | {
    type: 'appendPlanningDraftChunk';
    text: string;
} | {
    type: 'appendToolCall';
    toolCallId: string;
    title: string;
    status: ToolCallStatus;
} | {
    type: 'updateToolCall';
    toolCallId: string;
    title?: string;
    status: ToolCallStatus;
} | {
    type: 'appendPlan';
    plan: PlanUpdate;
} | {
    type: 'appendPipelinePlan';
    plan: string;
    role?: PipelinePhase;
    agentName?: string;
    implementerUsesSandcastle?: boolean;
} | {
    type: 'revisePipelinePlan';
    plan: string;
    role?: PipelinePhase;
    agentName?: string;
    implementerUsesSandcastle?: boolean;
} | {
    type: 'updatePipelinePlanStatus';
    status: PipelinePlanStatus;
    message?: string;
} | {
    type: 'revertPipelinePlanApproval';
} | {
    type: 'updatePipelineTimeline';
    timeline: PipelineTimelineStep[];
} | {
    type: 'setActivePipelineRole';
    role: PipelinePhase | null;
    agentName?: string | null;
} | {
    type: 'appendPipelineRoleOutput';
    role: PipelinePhase;
    agentName?: string;
    text: string;
    title: string;
} | {
    type: 'finalizeTeamRoleTurn';
} | {
    type: 'loadSessionStart';
} | {
    type: 'loadSessionEnd';
    ok: boolean;
} | {
    type: 'setRenderedMarkdown';
    items: Array<{
        index: number;
        html: string;
    }>;
} | {
    type: 'hydrateSharedState';
    state: ChatWebviewSharedState;
};
export declare function emptyPersistedState(): PersistedWebviewState;
export declare function emptyOrchestrationSlice(): {
    timeline: PipelineTimelineStep[];
    activeRole: PipelinePhase | null;
    activeAgentName: string | null;
};
export declare function selectPipelineChatProjection(state: AppState): {
    timeline: PipelineTimelineStep[];
    activeRole: PipelinePhase | null;
    activeAgentName: string | null;
    hasTimeline: boolean;
};
export declare function createCurrentTurn(turnId: string): CurrentTurn;
export declare function buildSharedSnapshot(state: AppState, version: number, updatedAt: number): ChatWebviewSharedState;
export declare function buildWebviewPersistedBundle(state: AppState, version: number, updatedAt: number): {
    shared: ChatWebviewSharedState;
    orchestration: {
        timeline: PipelineTimelineStep[];
        activeRole: PipelinePhase | null;
        activeAgentName: string | null;
    };
};
export declare function createInitialState(persistedValue: unknown): AppState;
export declare function appReducer(state: AppState, action: AppAction): AppState;
