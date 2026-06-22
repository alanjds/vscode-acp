import * as vscode from 'vscode';

import { getAgentConfig } from '../config/AgentConfig';

const DEFAULT_SKILLS_AGENTS = ['Cursor CLI', 'Codex Sandcastle', 'Cursor Sandcastle'];

export function isSkillsGloballyEnabled(): boolean {
  return vscode.workspace.getConfiguration('acp.skills').get<boolean>('enabled', true);
}

export function getSkillsDirectory(): string {
  return vscode.workspace.getConfiguration('acp.skills').get<string>('directory', '.agents/skills');
}

export function getSkillsMaxCatalogBytes(): number {
  return vscode.workspace.getConfiguration('acp.skills').get<number>('maxCatalogBytes', 65536);
}

export function getDefaultSkillsAgentNames(): string[] {
  return [...DEFAULT_SKILLS_AGENTS];
}

export function getConfiguredSkillsAgentNames(): string[] {
  return vscode.workspace.getConfiguration('acp.skills').get<string[]>('agents', DEFAULT_SKILLS_AGENTS);
}

/**
 * Returns true when skills should be wired for this agent name.
 */
export function isSkillsEnabledAgent(agentName: string): boolean {
  if (!isSkillsGloballyEnabled()) {
    return false;
  }

  const config = getAgentConfig(agentName);
  if (config && 'skills' in config && config.skills === false) {
    return false;
  }

  return getConfiguredSkillsAgentNames().includes(agentName);
}

export function isCursorCliAgent(agentName: string): boolean {
  return agentName === 'Cursor CLI';
}

export function isSandcastleSkillsAgent(agentName: string): boolean {
  return agentName === 'Codex Sandcastle' || agentName === 'Cursor Sandcastle';
}
