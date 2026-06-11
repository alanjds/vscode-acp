import * as vscode from 'vscode';
import { getPipelineConfig, getGeminiPipelineConfig } from './PipelineConfig';

/**
 * Configuration for a single ACP agent.
 */
export interface AgentConfigEntry {
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
export function getAgentNames(): string[] {
  const agentNames = Object.keys(getAgentConfigs());
  const pipeline = getPipelineConfig();
  const geminiPipeline = getGeminiPipelineConfig();

  const namesToAdd: string[] = [];
  
  if (pipeline.enabled && !agentNames.includes(pipeline.virtualAgentName)) {
    namesToAdd.push(pipeline.virtualAgentName);
  }
  
  if (pipeline.enabled && !agentNames.includes(geminiPipeline.virtualAgentName)) {
    namesToAdd.push(geminiPipeline.virtualAgentName);
  }

  return [...agentNames, ...namesToAdd];
}

/**
 * Get a specific agent config by name.
 */
export function getAgentConfig(name: string): AgentConfigEntry | undefined {
  return getAgentConfigs()[name];
}
