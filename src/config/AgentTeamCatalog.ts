import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

import * as yaml from 'js-yaml';

import {
  type AgentTeamDefinition,
  type TeamRoleId,
  validateAgentTeamDefinition,
} from './AgentTeamConfig';
import { isPipelineEnabled } from './PipelineConfig';
import { compileTeamToPipeline, type CompiledTeamMetadata } from '../pipeline/AgentTeamCompiler';
import type { PipelineDefinition } from './PipelineCatalog';
import { resolveWorkspaceIdentity } from '../core/WorkspaceIdentity';
import {
  getInstructionsMaxBytes,
  InstructionResolver,
  isInstructionError,
} from '../instructions/InstructionResolver';
import { log } from '../utils/Logger';

export type { CompiledTeamMetadata };

const TEAM_DIR = path.join('.acp', 'teams');
const INVALID_SUFFIX = ' (invalid)';

export interface AgentTeamEntry {
  filePath: string;
  displayName: string;
  definition?: AgentTeamDefinition;
  pipeline?: PipelineDefinition;
  errors: string[];
  metadata?: CompiledTeamMetadata;
}

function readAgentConfigs(): Record<string, unknown> {
  return vscode.workspace.getConfiguration('acp').get<Record<string, unknown>>('agents', {});
}

export function loadWorkspaceTeamEntries(
  workspaceCwd: string,
  agentConfigs: Record<string, unknown> = readAgentConfigs(),
): AgentTeamEntry[] {
  const dir = path.join(workspaceCwd, TEAM_DIR);
  if (!fs.existsSync(dir)) {
    return [];
  }

  let entries: string[];
  try {
    entries = fs.readdirSync(dir);
  } catch (e) {
    log(`Failed to read ACP team directory ${dir}: ${e}`);
    return [];
  }

  const resolver = new InstructionResolver(workspaceCwd, getInstructionsMaxBytes());
  const teamEntries: AgentTeamEntry[] = [];
  const seenIds = new Set<string>();

  for (const entry of entries.sort()) {
    if (!entry.endsWith('.yaml') && !entry.endsWith('.yml')) {
      continue;
    }
    const filePath = path.join(dir, entry);
    teamEntries.push(parseTeamFile(filePath, agentConfigs, resolver, seenIds));
  }

  return teamEntries;
}

function parseTeamFile(
  filePath: string,
  agentConfigs: Record<string, unknown>,
  resolver: InstructionResolver,
  seenIds: Set<string>,
): AgentTeamEntry {
  let parsed: unknown;
  try {
    const text = fs.readFileSync(filePath, 'utf8');
    parsed = yaml.load(text);
  } catch (e: any) {
    const fallbackTitle = path.basename(filePath, path.extname(filePath));
    return {
      filePath,
      displayName: `${fallbackTitle}${INVALID_SUFFIX}`,
      errors: [`YAML parse error: ${e.message || String(e)}`],
    };
  }

  const resolvedContents = new Map<TeamRoleId, string>();

  const validation = validateAgentTeamDefinition(
    parsed,
    filePath,
    agentConfigs,
    (roleId, instructionsPath) => {
      const outcome = resolver.resolve(instructionsPath, filePath);
      if (isInstructionError(outcome)) {
        return null;
      }
      resolvedContents.set(roleId, outcome.content);
      return outcome.content;
    },
  );

  if (!validation.definition) {
    const partialTitle = extractPartialTitle(parsed);
    return {
      filePath,
      displayName: `${partialTitle}${INVALID_SUFFIX}`,
      errors: validation.errors,
    };
  }

  if (seenIds.has(validation.definition.id)) {
    return {
      filePath,
      displayName: `${validation.definition.title}${INVALID_SUFFIX}`,
      definition: validation.definition,
      errors: [`Team id "${validation.definition.id}" is duplicated.`],
    };
  }
  seenIds.add(validation.definition.id);

  const resolvedInstructions = Object.fromEntries(resolvedContents) as Record<TeamRoleId, string>;
  const compiled = compileTeamToPipeline(
    validation.definition,
    resolvedInstructions,
    filePath,
    agentConfigs,
  );

  if (!compiled.pipeline) {
    return {
      filePath,
      displayName: `${validation.definition.title}${INVALID_SUFFIX}`,
      definition: validation.definition,
      errors: compiled.errors,
    };
  }

  return {
    filePath,
    displayName: validation.definition.title,
    definition: validation.definition,
    pipeline: compiled.pipeline,
    metadata: compiled.pipeline.metadata,
    errors: [],
  };
}

function extractPartialTitle(parsed: unknown): string {
  if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
    const title = (parsed as Record<string, unknown>).title;
    if (typeof title === 'string' && title.trim()) {
      return title.trim();
    }
    const id = (parsed as Record<string, unknown>).id;
    if (typeof id === 'string' && id.trim()) {
      return id.trim();
    }
  }
  return 'Team';
}

export function getTeamEntries(
  workspaceCwd: string = resolveWorkspaceIdentity().cwd,
  agentConfigs: Record<string, unknown> = readAgentConfigs(),
): AgentTeamEntry[] {
  if (!isPipelineEnabled()) {
    return [];
  }
  return loadWorkspaceTeamEntries(workspaceCwd, agentConfigs);
}

export function getTeamAgentDisplayNames(
  workspaceCwd: string = resolveWorkspaceIdentity().cwd,
  agentConfigs: Record<string, unknown> = readAgentConfigs(),
): string[] {
  return getTeamEntries(workspaceCwd, agentConfigs).map(entry => entry.displayName);
}

export function getValidTeamPipelines(
  workspaceCwd: string = resolveWorkspaceIdentity().cwd,
  agentConfigs: Record<string, unknown> = readAgentConfigs(),
): PipelineDefinition[] {
  return getTeamEntries(workspaceCwd, agentConfigs)
    .filter(entry => entry.pipeline !== undefined)
    .map(entry => entry.pipeline!);
}

export function getTeamEntryForAgent(
  agentName: string,
  workspaceCwd: string = resolveWorkspaceIdentity().cwd,
  agentConfigs: Record<string, unknown> = readAgentConfigs(),
): AgentTeamEntry | null {
  return getTeamEntries(workspaceCwd, agentConfigs)
    .find(entry => entry.displayName === agentName || entry.definition?.title === agentName) ?? null;
}

export function isTeamVirtualAgentName(
  agentName: string,
  workspaceCwd: string = resolveWorkspaceIdentity().cwd,
  agentConfigs: Record<string, unknown> = readAgentConfigs(),
): boolean {
  return getTeamEntryForAgent(agentName, workspaceCwd, agentConfigs) !== null;
}

export function isValidTeamVirtualAgentName(
  agentName: string,
  workspaceCwd: string = resolveWorkspaceIdentity().cwd,
  agentConfigs: Record<string, unknown> = readAgentConfigs(),
): boolean {
  const entry = getTeamEntryForAgent(agentName, workspaceCwd, agentConfigs);
  return entry !== null && entry.errors.length === 0 && entry.pipeline !== undefined;
}

export function getTeamTooltip(entry: AgentTeamEntry): string {
  if (entry.errors.length > 0) {
    return entry.errors.join('\n');
  }
  if (!entry.definition) {
    return entry.displayName;
  }
  const roleSummary = Object.entries(entry.definition.roles)
    .map(([roleId, role]) => `${roleId}: ${role.agent}`)
    .join(' · ');
  return `Team · ${roleSummary}`;
}

export function detectTitleConflicts(
  workspaceCwd: string,
  pipelineTitles: string[],
  agentConfigs: Record<string, unknown> = readAgentConfigs(),
): Map<string, string[]> {
  const conflicts = new Map<string, string[]>();
  const titleSources = new Map<string, string[]>();

  for (const title of pipelineTitles) {
    titleSources.set(title, [...(titleSources.get(title) ?? []), 'pipeline']);
  }

  for (const entry of getTeamEntries(workspaceCwd, agentConfigs)) {
    const title = entry.definition?.title ?? entry.displayName.replace(INVALID_SUFFIX, '');
    titleSources.set(title, [...(titleSources.get(title) ?? []), `team:${entry.filePath}`]);
  }

  for (const [title, sources] of titleSources) {
    if (sources.length > 1) {
      conflicts.set(title, sources);
    }
  }

  return conflicts;
}
