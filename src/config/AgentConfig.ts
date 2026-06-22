import * as vscode from 'vscode';
import { getTeamAgentDisplayNames } from './AgentTeamCatalog';
import { getPipelineAgentNames } from './PipelineCatalog';

/**
 * Configuration for a single ACP agent.
 */
export interface AcpAgentConfigEntry {
  /** Legacy entries omit transport and are treated as native ACP processes. */
  transport?: 'acp';
  /** NPX package to run (e.g., "@anthropic-ai/claude-code@latest") */
  command: string;
  /** Command-line arguments */
  args?: string[];
  /** Environment variables */
  env?: Record<string, string>;
  /** Display name */
  displayName?: string;
  /** Enable IDEA MCP server */
  use_idea_mcp?: boolean;
  /** Enable custom MCP server */
  use_custom_mcp?: boolean;
}

export interface SandcastleAgentConfigEntry {
  transport: 'sandcastle';
  provider: 'codex' | 'cursor';
  model: string;
  displayName?: string;
  env?: Record<string, string>;
  effort?: 'low' | 'medium' | 'high' | 'xhigh';
}

export type AgentConfigEntry = AcpAgentConfigEntry | SandcastleAgentConfigEntry;

export function isSandcastleAgentConfig(
  config: AgentConfigEntry,
): config is SandcastleAgentConfigEntry {
  return config.transport === 'sandcastle';
}

/**
 * Read agent configurations from VS Code settings.
 * Returns a map of agent name → config.
 */
export function getAgentConfigs(): Record<string, AgentConfigEntry> {
  const config = vscode.workspace.getConfiguration('acp');
  const agents = config.get<Record<string, AgentConfigEntry>>('agents', {});
  return agents;
}

/**
 * Get the list of agent names available.
 */
export function getAgentNames(
  workspaceCwd?: string,
  agentConfigs: Record<string, AgentConfigEntry> = getAgentConfigs(),
): string[] {
  const agentNames = Object.keys(agentConfigs);
  const pipelineNames = getPipelineAgentNames(workspaceCwd, agentConfigs);
  const teamNames = getTeamAgentDisplayNames(workspaceCwd, agentConfigs)
    .filter(name => !pipelineNames.includes(name.replace(/ \(invalid\)$/, '')));
  const virtualNames = [...pipelineNames, ...teamNames]
    .filter(name => !agentNames.includes(name));

  return [...agentNames, ...virtualNames];
}

/**
 * Get a specific agent config by name.
 */
export function getAgentConfig(name: string): AgentConfigEntry | undefined {
  return getAgentConfigs()[name];
}
