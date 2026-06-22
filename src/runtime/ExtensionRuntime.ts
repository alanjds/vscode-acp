import * as vscode from 'vscode';

import { AgentManager } from '../core/AgentManager';
import { ConnectionManager } from '../core/ConnectionManager';
import { DebugTraceStore } from '../core/DebugTraceStore';
import { SessionManager } from '../core/SessionManager';
import { SessionHistoryStore } from '../core/SessionHistoryStore';
import { resolveWorkspaceIdentity } from '../core/WorkspaceIdentity';
import { SessionUpdateHandler } from '../handlers/SessionUpdateHandler';
import { SessionTreeProvider } from '../ui/SessionTreeProvider';
import { StatusBarManager } from '../ui/StatusBarManager';
import { ChatWebviewController } from '../ui/ChatWebviewController';
import { ChatWebviewProvider } from '../ui/ChatWebviewProvider';
import { ChatWebviewStateStore } from '../ui/ChatWebviewStateStore';
import { ChatEditorPanelManager } from '../ui/ChatEditorPanelManager';
import { DebugWebviewPanel } from '../ui/DebugWebviewPanel';
import { getEditorContextSnapshot, initializeOpenEditorsTracker, trackLastKnownEditorContext } from '../ui/EditorContext';
import {
  EDITOR_CONTEXT_LINK_STATE_KEY,
  registerCommands,
} from '../commands/RegisterCommands';
import { log, disposeChannels } from '../utils/Logger';
import { initTelemetry, sendEvent } from '../utils/TelemetryManager';
import { version as extensionVersion } from '../../package.json';
import { activateFeaturePlugins } from '../plugins/FeaturePluginRegistry';
import { InlineChatPlugin } from '../plugins/inlineChat/InlineChatPlugin';
import { OrchestrationPlugin } from '../plugins/orchestration/OrchestrationPlugin';
import { SandcastlePlugin } from '../plugins/sandcastle/SandcastlePlugin';
import { SandcastlePromotion } from '../sandcastle/SandcastlePromotion';

class RuntimeResources implements vscode.Disposable {
  private readonly resources: vscode.Disposable[] = [];
  private disposed = false;

  add<T extends vscode.Disposable>(resource: T): T {
    if (this.disposed) {
      resource.dispose();
      throw new Error('Extension runtime is already disposed.');
    }
    this.resources.push(resource);
    return resource;
  }

  dispose(): void {
    if (this.disposed) { return; }
    this.disposed = true;
    for (const resource of this.resources.splice(0).reverse()) {
      resource.dispose();
    }
  }
}

export function startExtensionRuntime(context: vscode.ExtensionContext): vscode.Disposable {
  log('ACP Client extension activating...');
  const resources = new RuntimeResources();
  try {
    return initializeExtensionRuntime(context, resources);
  } catch (error) {
    resources.dispose();
    throw error;
  }
}

function initializeExtensionRuntime(
  context: vscode.ExtensionContext,
  resources: RuntimeResources,
): vscode.Disposable {
  // --- Telemetry ---
  const telemetryReporter = initTelemetry();
  resources.add(telemetryReporter);

  // --- Core services ---
  for (const tracker of initializeOpenEditorsTracker()) { resources.add(tracker); }
  resources.add(trackLastKnownEditorContext());
  const debugTraceStore = new DebugTraceStore();
  const sessionUpdateHandler = new SessionUpdateHandler(debugTraceStore);
  const agentManager = new AgentManager();
  const connectionManager = new ConnectionManager(sessionUpdateHandler, debugTraceStore);
  const sessionManager = new SessionManager(
    agentManager,
    connectionManager,
  );
  resources.add({ dispose: () => sessionManager.dispose() });
  const workspaceIdentity = () => resolveWorkspaceIdentity();

  // Persistent client-side session-history cache (used as the tier-2 tree
  // source for agents that support session/load or session/resume but not
  // session/list).
  const historyStore = new SessionHistoryStore(context.workspaceState);
  sessionManager.setHistoryStore(historyStore);
  resources.add({ dispose: () => historyStore.dispose() });

  // --- UI ---
  const sessionTreeProvider = new SessionTreeProvider(sessionManager, historyStore, workspaceIdentity);
  const treeView = vscode.window.createTreeView('acp-sessions', {
    treeDataProvider: sessionTreeProvider,
  });
  resources.add(sessionTreeProvider);
  resources.add(treeView);
  const debugWebviewPanel = new DebugWebviewPanel(
    context.extensionUri,
    sessionManager,
    debugTraceStore,
    extensionVersion,
  );
  resources.add(debugWebviewPanel);

  const chatStateStore = new ChatWebviewStateStore(context.workspaceState);
  resources.add(chatStateStore);
  const chatController = new ChatWebviewController(
    context.extensionUri,
    sessionManager,
    sessionUpdateHandler,
    chatStateStore,
    () => getEditorContextSnapshot(),
    debugTraceStore,
    (chatState) => debugWebviewPanel.open(chatState),
  );
  resources.add(chatController);
  const chatWebviewProvider = new ChatWebviewProvider(chatController);
  resources.add({ dispose: () => chatWebviewProvider.dispose() });
  const chatEditorPanelManager = new ChatEditorPanelManager(chatController, chatStateStore);
  resources.add(chatEditorPanelManager);
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
  resources.add(chatViewRegistration);
  const chatEditorSerializerRegistration = vscode.window.registerWebviewPanelSerializer(
    ChatEditorPanelManager.viewType,
    chatEditorPanelManager,
  );
  resources.add(chatEditorSerializerRegistration);

  const statusBarManager = new StatusBarManager(sessionManager);
  resources.add(statusBarManager);

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
  });
  for (const command of commandDisposables) { resources.add(command); }
  const openDebugSnapshotCmd = vscode.commands.registerCommand('acp.openDebugSnapshot', async () => {
    sendEvent('command/openDebugSnapshot');
    await debugWebviewPanel.open();
  });
  resources.add(openDebugSnapshotCmd);
  const sandcastlePromotion = new SandcastlePromotion(sessionManager);
  const featurePlugins = activateFeaturePlugins([
    {
      plugin: new OrchestrationPlugin(),
      context: {
        sessionManager,
        sessionTreeProvider,
        chatController,
        workspaceCwd: () => workspaceIdentity().cwd,
        sandcastlePromotion,
      },
    },
    {
      plugin: new SandcastlePlugin(),
      context: { sessionManager, sandcastlePromotion },
    },
    {
      plugin: new InlineChatPlugin(),
      context: {
        extensionContext: context,
        sessionManager,
        workspaceIdentity,
        sandcastlePromotion,
      },
    },
  ]);
  resources.add(featurePlugins);
  resources.add({ dispose: () => sessionUpdateHandler.dispose() });
  resources.add({ dispose: () => disposeChannels() });

  sendEvent('extension/activated', { version: vscode.extensions.getExtension('damien-huyet.acp-client')?.packageJSON?.version ?? 'unknown' });
  log('ACP Client extension activated.');
  context.subscriptions.push(resources);
  return resources;
}
