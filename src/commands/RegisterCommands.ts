import * as vscode from 'vscode';

import { getAgentNames } from '../config/AgentConfig';
import { fetchRegistry } from '../config/RegistryClient';
import { classifyAgentError } from '../core/AgentError';
import { SessionHistoryStore } from '../core/SessionHistoryStore';
import { SessionManager } from '../core/SessionManager';
import { ChatWebviewProvider } from '../ui/ChatWebviewProvider';
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
  historyStore: SessionHistoryStore;
}

export function registerCommands({
  context,
  sessionManager,
  sessionTreeProvider,
  chatWebviewProvider,
  historyStore,
}: RegisterCommandsDependencies): vscode.Disposable[] {
  const connectAgentCmd = vscode.commands.registerCommand('acp.connectAgent', async (agentNameOrItem?: string | any) => {
    let agentName: string | undefined;
    if (typeof agentNameOrItem === 'string') {
      agentName = agentNameOrItem;
    } else if (agentNameOrItem?.agentName) {
      agentName = agentNameOrItem.agentName;
    }

    if (!agentName) {
      const agentNames = getAgentNames();
      if (agentNames.length === 0) {
        vscode.window.showWarningMessage(
          'No ACP agents configured. Add agents in Settings > ACP > Agents.',
        );
        return;
      }
      agentName = await vscode.window.showQuickPick(agentNames, {
        placeHolder: 'Select an agent to connect',
        title: 'Connect to Agent',
      });
      if (!agentName) { return; }
    }

    const currentAgent = sessionManager.getActiveAgentName();
    if (currentAgent && currentAgent !== agentName && chatWebviewProvider.hasChatContent) {
      const choice = await vscode.window.showWarningMessage(
        `Switch to ${agentName}? This will disconnect ${currentAgent} and clear the chat history.`,
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

  const openSessionCmd = vscode.commands.registerCommand('acp.openSession', async (arg?: any) => {
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

    if (chatWebviewProvider.hasChatContent) {
      const choice = await vscode.window.showWarningMessage(
        'Open a different session? This will replace the current chat history.',
        'Open Session',
        'Cancel',
      );
      if (choice !== 'Open Session') { return; }
    }

    try {
      await vscode.commands.executeCommand(FOCUS_CHAT_COMMAND);
      const caps = sessionManager.getCachedCapabilities(agentName);
      if (caps?.load) {
        await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: 'Loading session...',
            cancellable: false,
          },
          async () => {
            await sessionManager.loadSession(agentName, sessionId);
          },
        );
      } else if (caps?.resume) {
        await sessionManager.resumeSession(agentName, sessionId);
        vscode.window.showInformationMessage('Resumed session (history not replayed).');
      } else {
        vscode.window.showErrorMessage(
          `Agent "${agentName}" does not support loading or resuming sessions.`,
        );
      }
    } catch (e: any) {
      logError('Failed to open session', e);
      await showClassifiedAgentError('Failed to open session', e);
    }
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
    newConversationCmd,
    disconnectAgentCmd,
    openChatCmd,
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
