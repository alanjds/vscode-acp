import * as vscode from 'vscode';
import { SessionManager } from '../core/SessionManager';
import { classifyAgentError } from '../core/AgentError';

/**
 * Manages the status bar item showing ACP connection status.
 */
export class StatusBarManager {
  private statusBarItem: vscode.StatusBarItem;

  constructor(private readonly sessionManager: SessionManager) {
    this.statusBarItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Left,
      100,
    );
    this.statusBarItem.command = 'acp.connectAgent';
    this.updateStatus();

    // Update on agent changes
    this.sessionManager.on('agent-connected', () => this.updateStatus());
    this.sessionManager.on('agent-disconnected', () => this.updateStatus());
    this.sessionManager.on('active-session-changed', () => this.updateStatus());
    this.sessionManager.on('agent-error', (_agentNameOrId: string, error?: unknown) => this.showError(error));
    this.sessionManager.on('agent-closed', () => this.updateStatus());
  }

  private updateStatus(): void {
    const activeSession = this.sessionManager.getActiveSession();
    const connectedAgents = this.sessionManager.getConnectedAgentNames();

    if (connectedAgents.length === 0) {
      this.statusBarItem.text = '$(hubot) ACP: Disconnected';
      this.statusBarItem.tooltip = 'Click to connect to an agent';
      this.statusBarItem.backgroundColor = undefined;
    } else {
      const agentName = activeSession?.agentDisplayName || connectedAgents[0];
      this.statusBarItem.text = `$(hubot) ACP: ${agentName}`;
      this.statusBarItem.tooltip = `Connected to ${agentName}\n${connectedAgents.length} agent(s) connected`;
      this.statusBarItem.backgroundColor = undefined;
    }

    this.statusBarItem.show();
  }

  private showError(error?: unknown): void {
    const classified = error ? classifyAgentError(error) : null;
    this.statusBarItem.text = '$(error) ACP: Error';
    this.statusBarItem.tooltip = classified
      ? `${classified.message}\n${classified.actionHint}`
      : 'ACP agent error. Open logs for details.';
    this.statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
  }

  dispose(): void {
    this.statusBarItem.dispose();
  }
}
