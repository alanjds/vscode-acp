import * as vscode from 'vscode';

import { AgentManager } from './core/AgentManager';
import { ConnectionManager } from './core/ConnectionManager';
import { DebugTraceStore } from './core/DebugTraceStore';
import { SessionManager } from './core/SessionManager';
import { SessionHistoryStore } from './core/SessionHistoryStore';
import { resolveWorkspaceIdentity } from './core/WorkspaceIdentity';
import { SessionUpdateHandler } from './handlers/SessionUpdateHandler';
import { SessionTreeProvider } from './ui/SessionTreeProvider';
import { StatusBarManager } from './ui/StatusBarManager';
import { ChatWebviewController } from './ui/ChatWebviewController';
import { ChatWebviewProvider } from './ui/ChatWebviewProvider';
import { ChatWebviewStateStore } from './ui/ChatWebviewStateStore';
import { ChatEditorPanelManager } from './ui/ChatEditorPanelManager';
import { DebugWebviewPanel } from './ui/DebugWebviewPanel';
import { getEditorContextSnapshot, initializeOpenEditorsTracker, trackLastKnownEditorContext } from './ui/EditorContext';
import { PipelineService } from './pipeline/PipelineService';
import {
  EDITOR_CONTEXT_LINK_STATE_KEY,
  PIPELINE_ENABLED_CONTEXT_KEY,
  registerCommands,
} from './commands/RegisterCommands';
import { isPipelineEnabled } from './config/PipelineConfig';
import { log, disposeChannels } from './utils/Logger';
import { initTelemetry, sendEvent } from './utils/TelemetryManager';
import { version as extensionVersion } from '../package.json';
import { InlineChatController } from './inlineChat/InlineChatController';
import { AcpInlineEditAgent } from './inlineChat/agent/AcpInlineEditAgent';
import { PatchApplyService } from './inlineChat/patch/PatchApplyService';

export function activate(context: vscode.ExtensionContext): void {
  log('ACP Client extension activating...');

  // --- Telemetry ---
  const telemetryReporter = initTelemetry();
  context.subscriptions.push(telemetryReporter);

  // --- Core services ---
  context.subscriptions.push(...initializeOpenEditorsTracker());
  context.subscriptions.push(trackLastKnownEditorContext());
  const debugTraceStore = new DebugTraceStore();
  const sessionUpdateHandler = new SessionUpdateHandler(debugTraceStore);
  const agentManager = new AgentManager();
  const connectionManager = new ConnectionManager(sessionUpdateHandler, debugTraceStore);
  const sessionManager = new SessionManager(
    agentManager,
    connectionManager,
  );
  const workspaceIdentity = () => resolveWorkspaceIdentity();
  const pipelineService = new PipelineService(
    () => workspaceIdentity().cwd,
  );
  sessionManager.setPipelineService(pipelineService);

  const inlineChatController = new InlineChatController(
    context,
    new AcpInlineEditAgent(workspaceIdentity, sessionManager),
    new PatchApplyService(),
  );

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
  const debugWebviewPanel = new DebugWebviewPanel(
    context.extensionUri,
    sessionManager,
    debugTraceStore,
    extensionVersion,
  );

  const chatStateStore = new ChatWebviewStateStore(context.workspaceState);
  const chatController = new ChatWebviewController(
    context.extensionUri,
    sessionManager,
    sessionUpdateHandler,
    chatStateStore,
    pipelineService,
    () => getEditorContextSnapshot(),
    debugTraceStore,
    (chatState) => debugWebviewPanel.open(chatState),
  );
  const chatWebviewProvider = new ChatWebviewProvider(chatController);
  const chatEditorPanelManager = new ChatEditorPanelManager(chatController, chatStateStore);
  const initialEditorContextLinked = context.workspaceState.get<boolean>(
    EDITOR_CONTEXT_LINK_STATE_KEY,
    false,
  );
  chatWebviewProvider.setEditorContextLinked(initialEditorContextLinked);
  void vscode.commands.executeCommand('setContext', EDITOR_CONTEXT_LINK_STATE_KEY, initialEditorContextLinked);
  void vscode.commands.executeCommand('setContext', PIPELINE_ENABLED_CONTEXT_KEY, isPipelineEnabled());
  const chatViewRegistration = vscode.window.registerWebviewViewProvider(
    ChatWebviewProvider.viewType,
    chatWebviewProvider,
    { webviewOptions: { retainContextWhenHidden: true } },
  );
  const chatEditorSerializerRegistration = vscode.window.registerWebviewPanelSerializer(
    ChatEditorPanelManager.viewType,
    chatEditorPanelManager,
  );

  const statusBarManager = new StatusBarManager(sessionManager);
  const pipelineYamlWatcher = vscode.workspace.createFileSystemWatcher('**/.acp/pipelines/*.yaml');
  const pipelineYmlWatcher = vscode.workspace.createFileSystemWatcher('**/.acp/pipelines/*.yml');
  const refreshPipelineAgents = () => {
    sessionTreeProvider.invalidate();
  };
  const teamYamlWatcher = vscode.workspace.createFileSystemWatcher('**/.acp/teams/*.yaml');
  const teamYmlWatcher = vscode.workspace.createFileSystemWatcher('**/.acp/teams/*.yml');
  teamYamlWatcher.onDidCreate(refreshPipelineAgents);
  teamYamlWatcher.onDidChange(refreshPipelineAgents);
  teamYamlWatcher.onDidDelete(refreshPipelineAgents);
  teamYmlWatcher.onDidCreate(refreshPipelineAgents);
  teamYmlWatcher.onDidChange(refreshPipelineAgents);
  teamYmlWatcher.onDidDelete(refreshPipelineAgents);
  pipelineYamlWatcher.onDidCreate(refreshPipelineAgents);
  pipelineYamlWatcher.onDidChange(refreshPipelineAgents);
  pipelineYamlWatcher.onDidDelete(refreshPipelineAgents);
  pipelineYmlWatcher.onDidCreate(refreshPipelineAgents);
  pipelineYmlWatcher.onDidChange(refreshPipelineAgents);
  pipelineYmlWatcher.onDidDelete(refreshPipelineAgents);
  const pipelineConfigWatcher = vscode.workspace.onDidChangeConfiguration(event => {
    if (
      event.affectsConfiguration('acp.agents')
      || event.affectsConfiguration('acp.pipeline.enabled')
      || event.affectsConfiguration('acp.defaultWorkingDirectory')
      || event.affectsConfiguration('acp.instructions.maxBytes')
    ) {
      void vscode.commands.executeCommand('setContext', PIPELINE_ENABLED_CONTEXT_KEY, isPipelineEnabled());
      refreshPipelineAgents();
    }
  });

  // Notify chat webview when active session changes
  sessionManager.on('active-session-changed', () => {
    chatWebviewProvider.notifyActiveSessionChanged();
  });

  sessionManager.on('context-family-changed', (sessionId: string) => {
    if (sessionId === sessionManager.getActiveSessionId()) {
      chatWebviewProvider.notifyActiveSessionChanged();
    }
  });

  sessionManager.on('pending-shared-context-changed', (sessionId: string) => {
    if (sessionId === sessionManager.getActiveSessionId()) {
      chatWebviewProvider.notifyActiveSessionChanged();
    }
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
    chatEditorPanelManager,
    historyStore,
    pipelineService,
  });
  const openDebugSnapshotCmd = vscode.commands.registerCommand('acp.openDebugSnapshot', async () => {
    sendEvent('command/openDebugSnapshot');
    await debugWebviewPanel.open();
  });
  const openInlineChatCmd = vscode.commands.registerCommand('damien.inlineChat.open', async () => {
    await inlineChatController.open();
  });

  // --- Register disposables ---
  context.subscriptions.push(
    treeView,
    chatViewRegistration,
    chatEditorSerializerRegistration,
    chatStateStore,
    chatController,
    chatEditorPanelManager,
    statusBarManager,
    pipelineYamlWatcher,
    pipelineYmlWatcher,
    teamYamlWatcher,
    teamYmlWatcher,
    pipelineConfigWatcher,
    openDebugSnapshotCmd,
    openInlineChatCmd,
    inlineChatController,
    ...commandDisposables,
    {
      dispose: () => {
        sessionManager.dispose();
        void pipelineService.dispose();
        sessionUpdateHandler.dispose();
        chatWebviewProvider.dispose();
        chatController.dispose();
        chatEditorPanelManager.dispose();
        chatStateStore.dispose();
        sessionTreeProvider.dispose();
        debugWebviewPanel.dispose();
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
