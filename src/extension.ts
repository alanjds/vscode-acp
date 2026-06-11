import * as vscode from 'vscode';

import { AgentManager } from './core/AgentManager';
import { ConnectionManager } from './core/ConnectionManager';
import { SessionManager } from './core/SessionManager';
import { SessionHistoryStore } from './core/SessionHistoryStore';
import { resolveWorkspaceIdentity } from './core/WorkspaceIdentity';
import { SessionUpdateHandler } from './handlers/SessionUpdateHandler';
import { SessionTreeProvider } from './ui/SessionTreeProvider';
import { StatusBarManager } from './ui/StatusBarManager';
import { ChatWebviewProvider } from './ui/ChatWebviewProvider';
import { captureEditorContext, captureOpenEditorPaths, initializeOpenEditorsTracker } from './ui/EditorContext';
import { PipelineService } from './pipeline/PipelineService';
import { EDITOR_CONTEXT_LINK_STATE_KEY, registerCommands } from './commands/RegisterCommands';
import { log, disposeChannels } from './utils/Logger';
import { initTelemetry, sendEvent } from './utils/TelemetryManager';

export function activate(context: vscode.ExtensionContext): void {
  log('ACP Client extension activating...');

  // --- Telemetry ---
  const telemetryReporter = initTelemetry();
  context.subscriptions.push(telemetryReporter);

  // --- Core services ---
  context.subscriptions.push(...initializeOpenEditorsTracker());
  const sessionUpdateHandler = new SessionUpdateHandler();
  const agentManager = new AgentManager();
  const connectionManager = new ConnectionManager(sessionUpdateHandler);
  const sessionManager = new SessionManager(
    agentManager,
    connectionManager,
    sessionUpdateHandler,
  );
  const workspaceIdentity = () => resolveWorkspaceIdentity();
  const pipelineService = new PipelineService(() => workspaceIdentity().cwd);
  sessionManager.setPipelineService(pipelineService);

  // Persistent client-side session-history cache (used as the tier-2 tree
  // source for agents that support session/load or session/resume but not
  // session/list).
  const historyStore = new SessionHistoryStore(context.workspaceState);
  sessionManager.setHistoryStore(historyStore);
  context.subscriptions.push({ dispose: () => historyStore.dispose() });

  // --- UI ---
  const sessionTreeProvider = new SessionTreeProvider(sessionManager, historyStore, workspaceIdentity);
  const treeView = vscode.window.createTreeView('acp-sessions', {
    treeDataProvider: sessionTreeProvider,
  });

  const chatWebviewProvider = new ChatWebviewProvider(
    context.extensionUri,
    sessionManager,
    sessionUpdateHandler,
    pipelineService,
    () => captureEditorContext(
      vscode.window.activeTextEditor,
      captureOpenEditorPaths(vscode.window.tabGroups.all),
    ),
  );
  const initialEditorContextLinked = context.workspaceState.get<boolean>(
    EDITOR_CONTEXT_LINK_STATE_KEY,
    false,
  );
  chatWebviewProvider.setEditorContextLinked(initialEditorContextLinked);
  void vscode.commands.executeCommand('setContext', EDITOR_CONTEXT_LINK_STATE_KEY, initialEditorContextLinked);
  const chatViewRegistration = vscode.window.registerWebviewViewProvider(
    ChatWebviewProvider.viewType,
    chatWebviewProvider,
    { webviewOptions: { retainContextWhenHidden: true } },
  );

  const statusBarManager = new StatusBarManager(sessionManager);

  // Notify chat webview when active session changes
  sessionManager.on('active-session-changed', () => {
    chatWebviewProvider.notifyActiveSessionChanged();
  });

  // Clear chat when new conversation is started
  sessionManager.on('clear-chat', () => {
    chatWebviewProvider.clearChat();
  });

  // Forward mode/model changes to webview
  sessionManager.on('mode-changed', (_sessionId: string, _modeId: string) => {
    const session = sessionManager.getActiveSession();
    if (session?.modes) {
      chatWebviewProvider.notifyModesUpdate(session.modes);
    }
  });

  sessionManager.on('model-changed', (_sessionId: string, _modelId: string) => {
    const session = sessionManager.getActiveSession();
    if (session?.models) {
      chatWebviewProvider.notifyModelsUpdate(session.models);
    }
  });

  // Session-load replay state — drive the webview overlay.
  sessionManager.on('session-load-start', () => {
    chatWebviewProvider.notifyLoadSessionStart();
  });
  sessionManager.on('session-load-end', (_sessionId: string, _agentName: string, ok: boolean) => {
    chatWebviewProvider.notifyLoadSessionEnd(ok);
    if (ok) {
      // The loadSession response carries modes/models/configOptions for the
      // restored session. Re-send the state so the pickers pick them up
      // (the original `active-session-changed` was emitted before the RPC
      // resolved, when those fields were still null).
      chatWebviewProvider.notifyActiveSessionChanged();
    }
  });

  // Session metadata (title) update — forward to chat banner.
  sessionManager.on('session-info-changed', (sessionId: string, update: any) => {
    if (sessionId !== sessionManager.getActiveSessionId()) { return; }
    chatWebviewProvider.notifySessionInfoUpdate(update?.title);
  });

  const commandDisposables = registerCommands({
    context,
    sessionManager,
    sessionTreeProvider,
    chatWebviewProvider,
    historyStore,
  });

  // --- Register disposables ---
  context.subscriptions.push(
    treeView,
    chatViewRegistration,
    statusBarManager,
    ...commandDisposables,
    {
      dispose: () => {
        sessionManager.dispose();
        void pipelineService.dispose();
        sessionUpdateHandler.dispose();
        chatWebviewProvider.dispose();
        sessionTreeProvider.dispose();
        disposeChannels();
      },
    },
  );

  sendEvent('extension/activated', { version: vscode.extensions.getExtension('damien-huyet.acp-client')?.packageJSON?.version ?? 'unknown' });
  log('ACP Client extension activated.');
}

export function deactivate(): void {
  log('ACP Client extension deactivated.');
}
