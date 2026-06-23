import type { AgentConfigEntry } from './AgentConfig';
import { getAgentConfigs } from './AgentConfig';
import {
  getPipelineDefinitionForAgent,
  getPipelineAgentNames,
  getPipelineDefinitions,
  type PipelineDefinition,
} from './PipelineCatalog';
import {
  getTeamAgentDisplayNames,
  getTeamEntryForAgent,
  type AgentTeamEntry,
} from './AgentTeamCatalog';
import { resolveWorkspaceIdentity } from '../core/WorkspaceIdentity';

export type AgentResolutionKind = 'configured' | 'pipeline' | 'team';

export interface AgentResolution {
  kind: AgentResolutionKind;
  name: string;
  runnable: boolean;
  pipeline?: PipelineDefinition;
  teamEntry?: AgentTeamEntry;
  errors: string[];
}

function normalizeAgentName(agentName: string): string {
  return agentName.replace(/ \(invalid\)$/, '');
}

function readAgentConfigs(
  agentConfigs?: Record<string, AgentConfigEntry>,
): Record<string, AgentConfigEntry> {
  return agentConfigs ?? getAgentConfigs();
}

/**
 * Resolves how an agent name maps to configured, pipeline, or team virtual agents.
 */
export function resolveAgent(
  agentName: string,
  workspaceCwd: string = resolveWorkspaceIdentity().cwd,
  agentConfigs: Record<string, AgentConfigEntry> = readAgentConfigs(),
): AgentResolution | null {
  const normalized = normalizeAgentName(agentName);
  const configs = readAgentConfigs(agentConfigs);

  if (configs[normalized]) {
    return {
      kind: 'configured',
      name: normalized,
      runnable: true,
      errors: [],
    };
  }

  const teamEntry = getTeamEntryForAgent(normalized, workspaceCwd, configs);
  if (teamEntry) {
    return {
      kind: 'team',
      name: teamEntry.displayName,
      runnable: teamEntry.errors.length === 0 && teamEntry.pipeline !== undefined,
      pipeline: teamEntry.pipeline,
      teamEntry,
      errors: teamEntry.errors,
    };
  }

  const pipeline = getPipelineDefinitionForAgent(normalized, workspaceCwd, configs);
  if (pipeline) {
    return {
      kind: 'pipeline',
      name: pipeline.title,
      runnable: true,
      pipeline,
      errors: [],
    };
  }

  return null;
}

export function isVirtualAgentName(
  agentName: string,
  workspaceCwd?: string,
  agentConfigs?: Record<string, AgentConfigEntry>,
): boolean {
  const resolution = resolveAgent(agentName, workspaceCwd, agentConfigs);
  return resolution?.kind === 'pipeline' || resolution?.kind === 'team';
}

export function isRunnableVirtualAgent(
  agentName: string,
  workspaceCwd?: string,
  agentConfigs?: Record<string, AgentConfigEntry>,
): boolean {
  const resolution = resolveAgent(agentName, workspaceCwd, agentConfigs);
  return resolution !== null
    && (resolution.kind === 'pipeline' || resolution.kind === 'team')
    && resolution.runnable;
}

export function listConfiguredAgentNames(
  agentConfigs: Record<string, AgentConfigEntry> = readAgentConfigs(),
): string[] {
  return Object.keys(agentConfigs);
}

/**
 * All agent names shown in the Agents tree: configured + virtual pipeline + virtual team.
 */
export function listSelectableAgentNames(
  workspaceCwd: string = resolveWorkspaceIdentity().cwd,
  agentConfigs: Record<string, AgentConfigEntry> = readAgentConfigs(),
): string[] {
  const configured = listConfiguredAgentNames(agentConfigs);
  const pipelineNames = getPipelineAgentNames(workspaceCwd, agentConfigs);
  const teamNames = getTeamAgentDisplayNames(workspaceCwd, agentConfigs)
    .filter(name => !pipelineNames.includes(name.replace(/ \(invalid\)$/, '')));
  const virtualNames = [...pipelineNames, ...teamNames]
    .filter(name => !configured.includes(name));

  return [...configured, ...virtualNames];
}

export function getPipelineDefinitionsForWorkspace(
  workspaceCwd: string = resolveWorkspaceIdentity().cwd,
  agentConfigs: Record<string, AgentConfigEntry> = readAgentConfigs(),
): PipelineDefinition[] {
  return getPipelineDefinitions(workspaceCwd, agentConfigs);
}
