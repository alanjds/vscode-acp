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
import { AcpAgentRunner } from '../pipeline/AcpAgentRunner';
import { isSandboxEnabled } from '../sandbox/SandboxConfig';
import type { SandboxContext } from '../sandbox/SandboxContext';
import type { SandboxPromotionPanel } from '../sandbox/SandboxPromotionPanel';
import type { SandboxService } from '../sandbox/SandboxService';
import { resolveWorkspaceIdentity } from '../core/WorkspaceIdentity';
import { ChatWebviewProvider } from '../ui/ChatWebviewProvider';
import { ChatEditorPanelManager } from '../ui/ChatEditorPanelManager';
import { SessionTreeProvider } from '../ui/SessionTreeProvider';
import { PipelineService } from '../pipeline/PipelineService';
import { serializeCompiledTeamPipeline } from '../pipeline/AgentTeamCompiler';
import { getOutputChannel, getTrafficChannel, logError } from '../utils/Logger';
import { sendEvent } from '../utils/TelemetryManager';
import { SandcastlePromotionUi } from '../sandcastle/SandcastlePromotionUi';

export const EDITOR_CONTEXT_LINK_STATE_KEY = 'acp.editorContextLinked';
export const PIPELINE_ENABLED_CONTEXT_KEY = 'acp.pipelineEnabled';
export const SANDBOX_ENABLED_CONTEXT_KEY = 'acp.sandboxEnabled';

const FOCUS_CHAT_COMMAND = 'acp-chat.focus';

interface RegisterCommandsDependencies {
  context: vscode.ExtensionContext;
  sessionManager: SessionManager;
  sessionTreeProvider: SessionTreeProvider;
  chatWebviewProvider: ChatWebviewProvider;
  chatEditorPanelManager: ChatEditorPanelManager;
  historyStore: SessionHistoryStore;
  sandboxService: SandboxService;
  sandboxPromotionPanel: SandboxPromotionPanel;
  pipelineService: PipelineService;
}

export function registerCommands({
  context,
  sessionManager,
  sessionTreeProvider,
  chatWebviewProvider,
  chatEditorPanelManager,
  historyStore,
  sandboxService,
  sandboxPromotionPanel,
  pipelineService,
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

  const setPipelineEnabled = async (enabled: boolean): Promise<void> => {
    const config = vscode.workspace.getConfiguration('acp');
    await config.update('pipeline.enabled', enabled, vscode.ConfigurationTarget.Workspace);
    await vscode.commands.executeCommand('setContext', PIPELINE_ENABLED_CONTEXT_KEY, enabled);
    sessionTreeProvider.invalidate();
    vscode.window.showInformationMessage(`ACP pipeline agents ${enabled ? 'enabled' : 'disabled'}.`);
  };

  const enablePipelineAgentsCmd = vscode.commands.registerCommand('acp.enablePipelineAgents', async () => {
    await setPipelineEnabled(true);
  });

  const disablePipelineAgentsCmd = vscode.commands.registerCommand('acp.disablePipelineAgents', async () => {
    await setPipelineEnabled(false);
  });

  const setSandboxEnabled = async (enabled: boolean): Promise<void> => {
    const config = vscode.workspace.getConfiguration('acp.sandbox');
    await config.update('enabled', enabled, vscode.ConfigurationTarget.Workspace);
    await vscode.commands.executeCommand('setContext', SANDBOX_ENABLED_CONTEXT_KEY, enabled);
    vscode.window.showInformationMessage(
      enabled
        ? 'ACP sandbox enabled. Workspace-changing runs use isolated git worktrees.'
        : 'ACP sandbox disabled. Agents write directly to the workspace.',
    );
  };

  const enableSandboxCmd = vscode.commands.registerCommand('acp.enableSandbox', async () => {
    await setSandboxEnabled(true);
  });

  const disableSandboxCmd = vscode.commands.registerCommand('acp.disableSandbox', async () => {
    await setSandboxEnabled(false);
  });

  const toggleSandboxCmd = vscode.commands.registerCommand('acp.toggleSandbox', async () => {
    const config = vscode.workspace.getConfiguration('acp.sandbox');
    const enabled = config.get<boolean>('enabled', false);
    await setSandboxEnabled(!enabled);
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
      let opened = false;
      const caps = sessionManager.getCachedCapabilities(agentName);
      if (caps?.load) {
        await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: 'Loading session...',
            cancellable: false,
          },
          async () => {
            await sessionManager.loadSession(agentName, sessionId, { shareCurrentContext });
          },
        );
        opened = true;
      } else if (caps?.resume) {
        await sessionManager.resumeSession(agentName, sessionId, { shareCurrentContext });
        opened = true;
        vscode.window.showInformationMessage('Resumed session (history not replayed).');
      } else {
        vscode.window.showErrorMessage(
          `Agent "${agentName}" does not support loading or resuming sessions.`,
        );
      }
      if (opened && shareCurrentContext && !hasShareableContext) {
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

  const runInSandboxCmd = vscode.commands.registerCommand('acp.runInSandbox', async () => {
    if (!isSandboxEnabled()) {
      const enable = await vscode.window.showInformationMessage(
        'Sandbox mode is disabled. Enable acp.sandbox.enabled to run agents in an isolated worktree.',
        'Open Settings',
      );
      if (enable === 'Open Settings') {
        await vscode.commands.executeCommand('workbench.action.openSettings', 'acp.sandbox.enabled');
      }
      return;
    }

    const agentName = sessionManager.getActiveAgentName() ?? await resolveAgentName();
    if (!agentName) {
      return;
    }

    const prompt = await vscode.window.showInputBox({
      title: 'Run in Sandbox',
      prompt: `Enter a prompt for ${agentName}`,
      placeHolder: 'Describe the change to make in the sandbox worktree...',
    });
    if (!prompt?.trim()) {
      return;
    }

    const workspaceCwd = () => resolveWorkspaceIdentity().cwd;
    let sandbox: SandboxContext | undefined;
    try {
      sandbox = await sandboxService.create(workspaceCwd());
      const runner = new AcpAgentRunner(workspaceCwd);
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: `Running ${agentName} in sandbox...`,
          cancellable: false,
        },
        async () => runner.run(agentName, prompt.trim(), { sandbox }),
      );
      await sandboxPromotionPanel.show(sandbox);
    } catch (error) {
      if (sandbox) {
        await sandboxService.destroy(sandbox);
      }
      await showClassifiedAgentError('Sandbox run failed', error);
    }
  });

  const sandboxPromoteCmd = vscode.commands.registerCommand('acp.sandbox.promote', async () => {
    const sandbox = sandboxService.getRegistry().getActive();
    if (!sandbox) {
      vscode.window.showWarningMessage('No active sandbox to promote.');
      return;
    }
    await sandboxPromotionPanel.show(sandbox);
  });

  const sandboxDiscardCmd = vscode.commands.registerCommand('acp.sandbox.discard', async () => {
    const sandbox = sandboxService.getRegistry().getActive();
    if (!sandbox) {
      vscode.window.showWarningMessage('No active sandbox to discard.');
      return;
    }
    const confirm = await vscode.window.showWarningMessage(
      `Discard sandbox ${sandbox.id}?`,
      { modal: true },
      'Discard',
    );
    if (confirm !== 'Discard') {
      return;
    }
    await sandboxService.destroy(sandbox);
    vscode.window.showInformationMessage(`Sandbox ${sandbox.id} discarded.`);
  });

  const sandboxCleanupCmd = vscode.commands.registerCommand('acp.sandbox.cleanup', async () => {
    const removed = await sandboxService.cleanupStale();
    vscode.window.showInformationMessage(
      removed === 0 ? 'No stale sandboxes to clean up.' : `Removed ${removed} stale sandbox(es).`,
    );
  });

  const resolveActiveSandcastle = () => {
    const activeSession = sessionManager.getActiveSession();
    if (!activeSession) {
      throw new Error('No active ACP session.');
    }
    const config = getAgentConfig(activeSession.agentName);
    if (!config || !isSandcastleAgentConfig(config)) {
      throw new Error('The active agent is not managed by Sandcastle.');
    }
    const connection = sessionManager.getConnectionForSession(activeSession.sessionId);
    if (!connection) {
      throw new Error('The active Sandcastle connection is unavailable.');
    }
    return { activeSession, connection: connection.connection };
  };

  const sandcastleShowDiffCmd = vscode.commands.registerCommand('acp.sandcastle.showDiff', async () => {
    try {
      const { activeSession, connection } = resolveActiveSandcastle();
      const ui = new SandcastlePromotionUi();
      await ui.showDiff(await ui.preview(connection, activeSession.sessionId));
    } catch (error) {
      void vscode.window.showErrorMessage(error instanceof Error ? error.message : String(error));
    }
  });

  const sandcastleApplyCmd = vscode.commands.registerCommand('acp.sandcastle.apply', async () => {
    try {
      const { activeSession, connection } = resolveActiveSandcastle();
      await new SandcastlePromotionUi().apply(connection, activeSession.sessionId);
    } catch (error) {
      void vscode.window.showErrorMessage(error instanceof Error ? error.message : String(error));
    }
  });

  const sandcastleRejectCmd = vscode.commands.registerCommand('acp.sandcastle.reject', async () => {
    try {
      const { activeSession, connection } = resolveActiveSandcastle();
      const confirm = await vscode.window.showWarningMessage(
        'Reject all changes in the active Sandcastle sandbox?',
        { modal: true },
        'Reject',
      );
      if (confirm === 'Reject') {
        await new SandcastlePromotionUi().reject(connection, activeSession.sessionId);
      }
    } catch (error) {
      void vscode.window.showErrorMessage(error instanceof Error ? error.message : String(error));
    }
  });

  const showCompiledTeamPipelineCmd = vscode.commands.registerCommand('acp.showCompiledTeamPipeline', async (agentNameOrItem?: string | any) => {
    const agentName = await resolveAgentName(agentNameOrItem);
    if (!agentName) { return; }

    const pipeline = pipelineService.getCompiledPipelineForTeam(agentName.replace(/ \(invalid\)$/, ''));
    if (!pipeline) {
      vscode.window.showWarningMessage(`"${agentName}" is not a valid agent team.`);
      return;
    }

    const doc = await vscode.workspace.openTextDocument({
      content: serializeCompiledTeamPipeline(pipeline),
      language: 'json',
    });
    await vscode.window.showTextDocument(doc, { preview: true });
  });

  const rerunTeamReviewerCmd = vscode.commands.registerCommand('acp.rerunTeamReviewer', async (agentNameOrItem?: string | any) => {
    const activeSession = sessionManager.getActiveSession();
    const agentName = typeof agentNameOrItem === 'string'
      ? agentNameOrItem
      : activeSession?.agentName;
    if (!agentName) {
      vscode.window.showWarningMessage('Connect to an agent team before re-running the reviewer.');
      return;
    }

    if (!pipelineService.getLastTeamRunSnapshot()) {
      vscode.window.showWarningMessage('No completed team run is available for reviewer re-run.');
      return;
    }

    try {
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: `Re-running reviewer for ${agentName}...`,
          cancellable: true,
        },
        async (_progress, token) => {
          token.onCancellationRequested(() => pipelineService.cancelReviewerRerun());
          const output = await pipelineService.rerunTeamReviewer(agentName.replace(/ \(invalid\)$/, ''));
          chatWebviewProvider.notifyReviewerRerun(output);
        },
      );
    } catch (e: any) {
      await showClassifiedAgentError('Reviewer re-run failed', e);
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
    enablePipelineAgentsCmd,
    disablePipelineAgentsCmd,
    enableSandboxCmd,
    disableSandboxCmd,
    toggleSandboxCmd,
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
    runInSandboxCmd,
    sandboxPromoteCmd,
    sandboxDiscardCmd,
    sandboxCleanupCmd,
    sandcastleShowDiffCmd,
    sandcastleApplyCmd,
    sandcastleRejectCmd,
    showCompiledTeamPipelineCmd,
    rerunTeamReviewerCmd,
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
