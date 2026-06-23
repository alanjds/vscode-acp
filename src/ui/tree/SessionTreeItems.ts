import * as vscode from 'vscode';

import type { ContextFamilyInfo } from '../../core/SessionHistoryStore';

/**
 * Tier-1 — a configured agent. Collapsible only when we believe the agent
 * has any way to expose past sessions (either supports session/list, or has
 * locally-cached entries via SessionHistoryStore).
 */
export class AgentTreeItem extends vscode.TreeItem {
  constructor(
    public readonly agentName: string,
    public readonly connected: boolean,
    collapsibleState: vscode.TreeItemCollapsibleState,
    public readonly linkedToActiveContext: boolean = false,
  ) {
    super(agentName, collapsibleState);

    if (connected) {
      this.contextValue = 'agent-connected';
      this.iconPath = new vscode.ThemeIcon(
        'circle-filled',
        new vscode.ThemeColor('testing.iconPassed'),
      );
      this.description = 'connected';
      this.command = { command: 'acp.openChat', title: 'Open Chat' };
    } else {
      this.contextValue = 'agent-disconnected';
      this.iconPath = new vscode.ThemeIcon('circle-outline');
      this.description = '';
    }

    if (linkedToActiveContext) {
      this.description = connected ? 'connected · linked context' : 'linked context';
    }

    this.tooltip = connected
      ? `${agentName} — connected\nClick to open chat`
      : `${agentName} — not connected\nUse the plug icon to connect`;
    if (linkedToActiveContext) {
      this.tooltip += '\nShares the active context family';
    }
  }
}

/**
 * Tier-2 — a session belonging to an agent. Clicking it routes to
 * `acp.openSession` which calls `session/load` or `session/resume`.
 */
export class SessionTreeItem extends vscode.TreeItem {
  constructor(
    public readonly agentName: string,
    public readonly sessionId: string,
    label: string,
    public readonly isActive: boolean,
    description: string | undefined,
    tooltip: string,
    public readonly source: 'agent' | 'local',
    public readonly contextFamily: ContextFamilyInfo | null = null,
    public readonly linkedToActiveContext: boolean = false,
  ) {
    super(label, vscode.TreeItemCollapsibleState.None);
    this.contextValue = source === 'local' ? 'session-local' : 'session';
    this.description = linkedToActiveContext ? appendDescription(description, 'linked') : description;
    this.tooltip = contextFamily ? appendContextFamilyTooltip(tooltip, contextFamily) : tooltip;
    if (isActive) {
      this.iconPath = new vscode.ThemeIcon(
        'circle-filled',
        new vscode.ThemeColor('testing.iconPassed'),
      );
    } else if (linkedToActiveContext) {
      this.iconPath = new vscode.ThemeIcon('references');
    } else {
      this.iconPath = new vscode.ThemeIcon('comment-discussion');
    }
    this.command = {
      command: 'acp.openSession',
      title: 'Open Session',
      arguments: [{ agentName, sessionId }],
    };
  }
}

/**
 * A leaf node used to surface status / errors / fallbacks under an agent.
 */
export class InfoTreeItem extends vscode.TreeItem {
  constructor(
    public readonly kind:
      | 'loading'
      | 'empty'
      | 'unsupported'
      | 'error'
      | 'auth-required'
      | 'load-more',
    public readonly agentName: string,
    label: string,
    tooltip?: string,
    command?: vscode.Command,
  ) {
    super(label, vscode.TreeItemCollapsibleState.None);
    this.tooltip = tooltip;
    this.command = command;
    switch (kind) {
      case 'loading':
        this.iconPath = new vscode.ThemeIcon('loading~spin');
        this.contextValue = 'session-info-loading';
        break;
      case 'empty':
        this.iconPath = new vscode.ThemeIcon('inbox');
        this.contextValue = 'session-info-empty';
        break;
      case 'unsupported':
        this.iconPath = new vscode.ThemeIcon('info');
        this.contextValue = 'session-info-unsupported';
        break;
      case 'error':
        this.iconPath = new vscode.ThemeIcon('warning');
        this.contextValue = 'session-info-error';
        break;
      case 'auth-required':
        this.iconPath = new vscode.ThemeIcon('key');
        this.contextValue = 'session-info-auth';
        break;
      case 'load-more':
        this.iconPath = new vscode.ThemeIcon('chevron-down');
        this.contextValue = 'session-info-load-more';
        break;
    }
  }
}

export type AgentNode = AgentTreeItem;
export type ChildNode = SessionTreeItem | InfoTreeItem;

function appendDescription(description: string | undefined, suffix: string): string {
  return description ? `${description} · ${suffix}` : suffix;
}

function appendContextFamilyTooltip(tooltip: string, contextFamily: ContextFamilyInfo): string {
  const lines = [
    tooltip,
    `Context family: ${contextFamily.contextFamilyId}`,
  ];
  if (contextFamily.contextLinkedFrom) {
    lines.push(`Linked from: ${contextFamily.contextLinkedFrom.agentName} (${contextFamily.contextLinkedFrom.sessionId})`);
  }
  if (contextFamily.contextLinkedAt) {
    lines.push(`Linked at: ${contextFamily.contextLinkedAt}`);
  }
  return lines.join('\n');
}
