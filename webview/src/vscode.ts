import type {
  ChatWebviewSharedState,
  FileSearchResult,
  MarkdownRenderItem,
  MarkdownRenderedItem,
  ModelsState,
  ModesState,
  PipelinePhase,
  SessionConfigOption,
  DebugSnapshot,
  SessionSnapshot,
  SessionUpdate,
} from './chatTypes';
import type { OrchestrationState } from '../../src/ui/OrchestrationState';

export type HostToWebviewMessage =
  | {
      type: 'state';
      activeSessionId?: string | null;
      session?: SessionSnapshot | null;
    }
  | { type: 'sessionUpdate'; update: SessionUpdate; sessionId?: string; phase?: PipelinePhase; role?: PipelinePhase; agentName?: string; teamId?: string }
  | { type: 'promptStart' }
  | { type: 'promptEnd'; stopReason?: string; usage?: unknown }
  | { type: 'clearChat' }
  | { type: 'error'; message?: string }
  | { type: 'info'; message?: string }
  | { type: 'modesUpdate'; modes: ModesState }
  | { type: 'modelsUpdate'; models: ModelsState }
  | { type: 'configOptionsUpdate'; configOptions?: SessionConfigOption[] | null }
  | { type: 'loadSessionStart' }
  | { type: 'loadSessionEnd'; ok?: boolean }
  | { type: 'sessionInfoUpdate'; title?: string | null }
  | { type: 'externalUserMessage'; text: string }
  | { type: 'fileSearchResults'; requestId: number; results: FileSearchResult[] }
  | { type: 'pipelinePlanReady'; plan: string; role?: PipelinePhase; agentName?: string; teamId?: string; implementerUsesSandcastle?: boolean; revised?: boolean }
  | { type: 'pipelinePlanApprovalFailed'; message?: string }
  | { type: 'pipelineStatus'; status?: string; message?: string; stepId?: string; role?: PipelinePhase; agentName?: string; teamId?: string; implementerUsesSandcastle?: boolean }
  | { type: 'reviewerRerunReady'; output: string }
  | { type: 'markdownRendered'; items: MarkdownRenderedItem[] }
  | { type: 'debugSnapshot'; snapshot: DebugSnapshot }
  | { type: 'hydrateSharedState'; state: ChatWebviewSharedState }
  | { type: 'sharedStateUpdated'; state: ChatWebviewSharedState }
  | { type: 'hydrateOrchestrationState'; state: OrchestrationState }
  | { type: 'orchestrationStateUpdated'; state: OrchestrationState }
  | { type: string; [key: string]: unknown };

export type WebviewToHostMessage =
  | { type: 'ready' }
  | { type: 'sendPrompt'; text: string; agentText?: string }
  | { type: 'cancelTurn' }
  | { type: 'setMode'; modeId: string }
  | { type: 'setModel'; modelId: string }
  | { type: 'setConfigOption'; configId: string; value: string }
  | { type: 'approvePipelinePlan'; plan: string }
  | { type: 'rejectPipelinePlan' }
  | { type: 'executeCommand'; command: string }
  | { type: 'searchFiles'; query: string; requestId: number }
  | { type: 'openFile'; path: string }
  | { type: 'renderMarkdown'; items: MarkdownRenderItem[] }
  | { type: 'openDebugSnapshot'; chatState: unknown }
  | { type: 'refreshDebugSnapshot' }
  | { type: 'copyDebugSnapshot' }
  | { type: 'exportDebugSnapshot' }
  | { type: 'sharedStateChanged'; state: ChatWebviewSharedState }
  | { type: 'orchestrationStateChanged'; state: OrchestrationState };

type VsCodeApi<State> = {
  postMessage(message: WebviewToHostMessage): void;
  getState(): State | undefined;
  setState(state: State): void;
};

declare function acquireVsCodeApi<State = unknown>(): VsCodeApi<State>;

const vscode = acquireVsCodeApi<unknown>();

export function postMessage(message: WebviewToHostMessage): void {
  vscode.postMessage(message);
}

export function getState<State>(): State | undefined {
  return vscode.getState() as State | undefined;
}

export function setState<State>(state: State): void {
  vscode.setState(state);
}

export function onMessage(listener: (message: HostToWebviewMessage) => void): () => void {
  const handler = (event: MessageEvent<HostToWebviewMessage>) => {
    listener(event.data);
  };

  window.addEventListener('message', handler);
  return () => {
    window.removeEventListener('message', handler);
  };
}
