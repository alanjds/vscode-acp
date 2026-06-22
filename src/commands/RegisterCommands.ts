import * as vscode from 'vscode';

import {
  getAgentConfig,
  getAgentNames,
  isSandcastleAgentConfig,
} from '../config/AgentConfig';
import { fetchRegistry } from '../config/RegistryClient';
import { classifyAgentError } from '../core/AgentError';
import { SessionHistoryStore } from '../core/SessionHistoryStore';
import { SessionManager } from '../core/SessionManager';
import { ChatWebviewProvider } from '../ui/ChatWebviewProvider';
import { ChatEditorPanelManager } from '../ui/ChatEditorPanelManager';
import { SessionTreeProvider } from '../ui/SessionTreeProvider';
import { getOutputChannel, getTrafficChannel, logError } from '../utils/Logger';
import { sendEvent } from '../utils/TelemetryManager';

export const EDITOR_CONTEXT_LINK_STATE_KEY = 'acp.editorContextLinked';

const FOCUS_CHAT_COMMAND = 'acp-chat.focus';

interface RegisterCommandsDependencies {
  context: vscode.ExtensionContext;
  sessionManager: SessionManager;
  sessionTreeProvider: SessionTreeProvider;
  chatWebviewProvider: ChatWebviewProvider;
  chatEditorPanelManager: ChatEditorPanelManager;
  historyStore: SessionHistoryStore;
}

export function registerCommands({
  context,
  sessionManager,
  sessionTreeProvider,
  chatWebviewProvider,
  chatEditorPanelManager,
  historyStore,
}: RegisterCommandsDependencies): vscode.Disposable[] {
  const resolveAgentName = async (agentNameOrItem?: string | any): Promise<string | undefined> => {
    if (typeof agentNameOrItem === 'string') {
      return agentNameOrItem;
    }
    if (agentNameOrItem?.agentName) {
      return agentNameOrItem.agentName;
    }

    const agentNames = getAgentNames();
    if (agentNames.length === 0) {
      vscode.window.showWarningMessage(
        'No ACP agents configured. Add agents in Settings > ACP > Agents.',
      );
      return undefined;
    }

    return vscode.window.showQuickPick(agentNames, {
      placeHolder: 'Select an agent to connect',
      title: 'Connect to Agent',
    });
  };

  const connectAgentCmd = vscode.commands.registerCommand('acp.connectAgent', async (agentNameOrItem?: string | any) => {
    const agentName = await resolveAgentName(agentNameOrItem);
    if (!agentName) { return; }

    const selectedConfig = getAgentConfig(agentName);
    if (selectedConfig && !isSandcastleAgentConfig(selectedConfig)) {
      void vscode.window.showWarningMessage(
        `${agentName} runs directly on the host and is not isolated by Sandcastle.`,
      );
    }

    const currentAgent = sessionManager.getActiveAgentName();
    if (currentAgent && currentAgent !== agentName && chatWebviewProvider.hasChatContent) {
      const choice = await vscode.window.showWarningMessage(
        `Switch to ${agentName}? This will disconnect ${currentAgent} and clear the visible chat history.`,
        'Switch Agent',
        'Cancel',
      );
      if (choice !== 'Switch Agent') { return; }
      chatWebviewProvider.clearChat();
    }

    try {
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: `Connecting to ${agentName}...`,
          cancellable: false,
        },
        async () => {
          await sessionManager.connectToAgent(agentName!);
        },
      );
    } catch (e: any) {
      logError('Failed to connect to agent', e);
      await showClassifiedAgentError('Failed to connect', e);
    }
  });

  const connectAgentWithCurrentContextCmd = vscode.commands.registerCommand('acp.connectAgentWithCurrentContext', async (agentNameOrItem?: string | any) => {
    const agentName = await resolveAgentName(agentNameOrItem);
    if (!agentName) { return; }

    const currentAgent = sessionManager.getActiveAgentName();
    if (currentAgent === agentName) {
      vscode.window.showInformationMessage(`${agentName} is already active. No context handoff was prepared.`);
      return;
    }

    const hasShareableContext = sessionManager.hasShareableDiscussionContext(agentName);
    if (currentAgent && chatWebviewProvider.hasChatContent) {
      const choice = await vscode.window.showWarningMessage(
        `Connect to ${agentName} with current context? This will disconnect ${currentAgent}, clear the visible chat history, and include the current discussion in the next prompt.`,
        'Connect With Context',
        'Cancel',
      );
      if (choice !== 'Connect With Context') { return; }
      chatWebviewProvider.clearChat();
    }

    try {
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: `Connecting to ${agentName} with current context...`,
          cancellable: false,
        },
        async () => {
          await sessionManager.connectToAgent(agentName, { shareCurrentContext: true });
        },
      );
      await vscode.commands.executeCommand(FOCUS_CHAT_COMMAND);
      if (hasShareableContext) {
        chatWebviewProvider.showInfoMessage('Next prompt will include shared context.');
      } else {
        vscode.window.showInformationMessage('Connected. No current discussion context was available to share.');
        chatWebviewProvider.showInfoMessage('Connected. No current discussion context was available to share.');
      }
    } catch (e: any) {
      logError('Failed to connect to agent with current context', e);
      await showClassifiedAgentError('Failed to connect with context', e);
    }
  });

  const newConversationCmd = vscode.commands.registerCommand('acp.newConversation', async () => {
    const activeSession = sessionManager.getActiveSession();
    if (!activeSession) {
      await vscode.commands.executeCommand('acp.connectAgent');
      return;
    }

    if (chatWebviewProvider.hasChatContent) {
      const choice = await vscode.window.showWarningMessage(
        'Start a new conversation? This will clear the current chat history.',
        'New Conversation',
        'Cancel',
      );
      if (choice !== 'New Conversation') { return; }
    }

    try {
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: `Starting new conversation with ${activeSession.agentDisplayName}...`,
          cancellable: false,
        },
        async () => {
          await sessionManager.newConversation();
        },
      );
    } catch (e: any) {
      logError('Failed to start new conversation', e);
      vscode.window.showErrorMessage(`Failed to start new conversation: ${e.message}`);
    }
  });

  const disconnectAgentCmd = vscode.commands.registerCommand('acp.disconnectAgent', async (item?: any) => {
    const agentName = item?.agentName || sessionManager.getActiveAgentName();
    if (!agentName) {
      vscode.window.showInformationMessage('No agent connected.');
      return;
    }
    await sessionManager.disconnectAgent(agentName);
    vscode.window.showInformationMessage(`Disconnected from ${agentName}.`);
  });

  const openChatCmd = vscode.commands.registerCommand('acp.openChat', () => {
    vscode.commands.executeCommand(FOCUS_CHAT_COMMAND);
  });

  const openChatEditorCmd = vscode.commands.registerCommand('acp.openChatEditor', async () => {
    await chatEditorPanelManager.open();
  });

  const moveChatToEditorCmd = vscode.commands.registerCommand('acp.moveChatToEditor', async () => {
    await chatEditorPanelManager.open();
  });

  const sendPromptCmd = vscode.commands.registerCommand('acp.sendPrompt', async () => {
    vscode.commands.executeCommand(FOCUS_CHAT_COMMAND);
  });

  const cancelTurnCmd = vscode.commands.registerCommand('acp.cancelTurn', async () => {
    const activeId = sessionManager.getActiveSessionId();
    if (activeId) {
      try {
        await sessionManager.cancelTurn(activeId);
      } catch (e) {
        logError('Cancel failed', e);
      }
    }
  });

  const restartAgentCmd = vscode.commands.registerCommand('acp.restartAgent', async () => {
    const activeSession = sessionManager.getActiveSession();
    if (!activeSession) { return; }

    const agentName = activeSession.agentName;
    try {
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: `Restarting ${activeSession.agentDisplayName}...`,
          cancellable: false,
        },
        async () => {
          await sessionManager.disconnectAgent(agentName);
          await sessionManager.connectToAgent(agentName);
        },
      );
      vscode.window.showInformationMessage(`Restarted ${agentName}`);
    } catch (e: any) {
      await showClassifiedAgentError('Failed to restart', e);
    }
  });

  const showLogCmd = vscode.commands.registerCommand('acp.showLog', () => {
    sendEvent('command/showLog');
    getOutputChannel().show();
  });

  const showTrafficCmd = vscode.commands.registerCommand('acp.showTraffic', () => {
    sendEvent('command/showTraffic');
    getTrafficChannel().show();
  });

  const setModeCmd = vscode.commands.registerCommand('acp.setMode', async (modeId?: string) => {
    const activeId = sessionManager.getActiveSessionId();
    if (!activeId) { return; }

    if (!modeId) {
      modeId = await vscode.window.showInputBox({
        placeHolder: 'Enter mode ID (e.g., "plan", "code")',
        title: 'Set Agent Mode',
      }) || undefined;
    }
    if (modeId) {
      try {
        await sessionManager.setMode(activeId, modeId);
      } catch (e: any) {
        vscode.window.showErrorMessage(`Failed to set mode: ${e.message}`);
      }
    }
  });

  const setModelCmd = vscode.commands.registerCommand('acp.setModel', async (modelId?: string) => {
    const activeId = sessionManager.getActiveSessionId();
    if (!activeId) { return; }

    if (!modelId) {
      modelId = await vscode.window.showInputBox({
        placeHolder: 'Enter model ID',
        title: 'Set Agent Model',
      }) || undefined;
    }
    if (modelId) {
      try {
        await sessionManager.setModel(activeId, modelId);
      } catch (e: any) {
        vscode.window.showErrorMessage(`Failed to set model: ${e.message}`);
      }
    }
  });

  const refreshAgentsCmd = vscode.commands.registerCommand('acp.refreshAgents', () => {
    sessionTreeProvider.refresh();
  });

  const refreshSessionsCmd = vscode.commands.registerCommand('acp.refreshSessions', (arg?: any) => {
    const agentName = typeof arg === 'string' ? arg : arg?.agentName;
    sessionTreeProvider.invalidate(agentName);
  });

  const openSessionFromTree = async (arg: any, shareCurrentContext: boolean): Promise<void> => {
    const agentName: string | undefined = arg?.agentName;
    const sessionId: string | undefined = arg?.sessionId;
    if (!agentName || !sessionId) {
      vscode.window.showErrorMessage('Open Session: missing agentName/sessionId.');
      return;
    }

    if (sessionManager.getActiveSessionId() === sessionId) {
      vscode.commands.executeCommand(FOCUS_CHAT_COMMAND);
      return;
    }

    const hasShareableContext = shareCurrentContext
      && sessionManager.hasShareableDiscussionContext(agentName, sessionId);

    if (chatWebviewProvider.hasChatContent) {
      const message = shareCurrentContext
        ? 'Open a different session with the current context? This will replace the current chat history and share the current discussion with the target session on your next prompt.'
        : 'Open a different session? This will replace the current chat history.';
      const choice = await vscode.window.showWarningMessage(
        message,
        shareCurrentContext ? 'Open With Context' : 'Open Session',
        'Cancel',
      );
      if (choice !== (shareCurrentContext ? 'Open With Context' : 'Open Session')) { return; }
    }

    try {
      await vscode.commands.executeCommand(FOCUS_CHAT_COMMAND);
      const opened = await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: 'Opening session...',
          cancellable: false,
        },
        () => sessionManager.openSession(agentName, sessionId, { shareCurrentContext }),
      );
      if (!opened.historyReplayed) {
        vscode.window.showInformationMessage('Resumed session (history not replayed).');
      }
      if (shareCurrentContext && !hasShareableContext) {
        vscode.window.showInformationMessage('Opened session. No current discussion context was available to share.');
      }
    } catch (e: any) {
      logError('Failed to open session', e);
      await showClassifiedAgentError('Failed to open session', e);
    }
  };

  const openSessionCmd = vscode.commands.registerCommand('acp.openSession', async (arg?: any) => {
    await openSessionFromTree(arg, false);
  });

  const openSessionWithCurrentContextCmd = vscode.commands.registerCommand('acp.openSessionWithCurrentContext', async (arg?: any) => {
    await openSessionFromTree(arg, true);
  });

  const loadMoreSessionsCmd = vscode.commands.registerCommand('acp.loadMoreSessions', async (agentName?: string) => {
    if (!agentName) { return; }
    await sessionTreeProvider.loadMore(agentName);
  });

  const copySessionIdCmd = vscode.commands.registerCommand('acp.copySessionId', async (arg?: any) => {
    const sessionId = arg?.sessionId;
    if (!sessionId) { return; }
    await vscode.env.clipboard.writeText(sessionId);
    vscode.window.showInformationMessage(`Copied session ID: ${sessionId}`);
  });

  const forgetSessionCmd = vscode.commands.registerCommand('acp.forgetSession', async (arg?: any) => {
    const agentName = arg?.agentName;
    const sessionId = arg?.sessionId;
    if (!agentName || !sessionId) { return; }
    historyStore.forget(agentName, sessionId);
  });

  const addAgentCmd = vscode.commands.registerCommand('acp.addAgent', async () => {
    const name = await vscode.window.showInputBox({
      prompt: 'Agent name',
      placeHolder: 'my-agent',
      title: 'Add ACP Agent',
    });
    if (!name) { return; }

    const command = await vscode.window.showInputBox({
      prompt: 'Command to launch the agent',
      placeHolder: 'npx',
      title: 'Agent Command',
    });
    if (!command) { return; }

    const argsStr = await vscode.window.showInputBox({
      prompt: 'Arguments (space-separated)',
      placeHolder: '-y @my-org/agent',
      title: 'Agent Arguments',
    });
    const args = argsStr ? argsStr.split(/\s+/) : [];

    const config = vscode.workspace.getConfiguration('acp');
    const agents: Record<string, any> = { ...(config.get<Record<string, any>>('agents') || {}) };
    agents[name] = { command, args };
    await config.update('agents', agents, vscode.ConfigurationTarget.Global);
    sessionTreeProvider.refresh();
    vscode.window.showInformationMessage(`Agent "${name}" added.`);
    sendEvent('agent/added');
  });

  const removeAgentCmd = vscode.commands.registerCommand('acp.removeAgent', async (item?: any) => {
    const config = vscode.workspace.getConfiguration('acp');
    const agents: Record<string, any> = { ...(config.get<Record<string, any>>('agents') || {}) };
    const agentNames = Object.keys(agents);
    if (agentNames.length === 0) {
      vscode.window.showInformationMessage('No agents configured.');
      return;
    }

    const name = item?.agentName ?? await vscode.window.showQuickPick(agentNames, {
      placeHolder: 'Select agent to remove',
      title: 'Remove ACP Agent',
    });
    if (!name) { return; }

    const confirm = await vscode.window.showWarningMessage(
      `Remove agent "${name}"?`, { modal: true }, 'Remove',
    );
    if (confirm !== 'Remove') { return; }

    if (sessionManager.isAgentConnected(name)) {
      await sessionManager.disconnectAgent(name);
    }

    delete agents[name];
    await config.update('agents', agents, vscode.ConfigurationTarget.Global);
    sessionTreeProvider.refresh();
    vscode.window.showInformationMessage(`Agent "${name}" removed.`);
    sendEvent('agent/removed', { agentName: name });
  });

  const setEditorContextLinked = async (linked: boolean) => {
    chatWebviewProvider.setEditorContextLinked(linked);
    await context.workspaceState.update(EDITOR_CONTEXT_LINK_STATE_KEY, linked);
    await vscode.commands.executeCommand('setContext', EDITOR_CONTEXT_LINK_STATE_KEY, linked);
    vscode.window.setStatusBarMessage(
      linked ? 'ACP editor context link enabled.' : 'ACP editor context link disabled.',
      2500,
    );
  };

  const enableEditorContextLinkCmd = vscode.commands.registerCommand('acp.enableEditorContextLink', async () => {
    await setEditorContextLinked(true);
  });

  const disableEditorContextLinkCmd = vscode.commands.registerCommand('acp.disableEditorContextLink', async () => {
    await setEditorContextLinked(false);
  });

  const browseRegistryCmd = vscode.commands.registerCommand('acp.browseRegistry', async () => {
    sendEvent('registry/browse');
    try {
      const agents = await fetchRegistry();
      const items = agents.map(a => ({
        label: a.name,
        description: a.command,
        detail: a.description || '',
      }));
      if (items.length === 0) {
        vscode.window.showInformationMessage('No agents found in registry.');
        return;
      }
      await vscode.window.showQuickPick(items, {
        placeHolder: 'ACP Agent Registry',
        title: 'Available ACP Agents',
      });
    } catch (e: any) {
      vscode.window.showErrorMessage(`Failed to fetch registry: ${e.message}`);
    }
  });

  return [
    connectAgentCmd,
    connectAgentWithCurrentContextCmd,
    newConversationCmd,
    disconnectAgentCmd,
    openChatCmd,
    openChatEditorCmd,
    moveChatToEditorCmd,
    sendPromptCmd,
    cancelTurnCmd,
    restartAgentCmd,
    showLogCmd,
    showTrafficCmd,
    setModeCmd,
    setModelCmd,
    refreshAgentsCmd,
    refreshSessionsCmd,
    openSessionCmd,
    openSessionWithCurrentContextCmd,
    loadMoreSessionsCmd,
    copySessionIdCmd,
    forgetSessionCmd,
    addAgentCmd,
    removeAgentCmd,
    enableEditorContextLinkCmd,
    disableEditorContextLinkCmd,
    browseRegistryCmd,
  ];
}

async function showClassifiedAgentError(title: string, error: unknown): Promise<void> {
  const classified = classifyAgentError(error);
  const choice = await vscode.window.showErrorMessage(
    `${title}: ${classified.message}`,
    'Show Log',
    'Open Settings',
  );
  if (choice === 'Show Log') {
    getOutputChannel().show();
  } else if (choice === 'Open Settings') {
    await vscode.commands.executeCommand('workbench.action.openSettings', 'acp');
  }
}
