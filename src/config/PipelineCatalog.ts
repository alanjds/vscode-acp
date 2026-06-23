import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

import * as yaml from 'js-yaml';

import { getValidTeamPipelines } from './AgentTeamCatalog';
import { isPipelineEnabled } from './PipelineConfig';
import type { CompiledTeamMetadata } from '../pipeline/AgentTeamCompiler';
import { resolveWorkspaceIdentity } from '../core/WorkspaceIdentity';
import { log } from '../utils/Logger';
import { extractTemplateVariables, validatePipelineDefinition } from './PipelineValidator';

export type { CompiledTeamMetadata };
export { extractTemplateVariables, validatePipelineDefinition };

export type PipelineOutputType = 'markdown' | 'proposed_plan';
export type PipelineSideEffects = 'none' | 'workspace';

export interface PipelinePrimitiveDefinition {
  agent: string;
  prompt: string;
  output: PipelineOutputType;
  sideEffects: PipelineSideEffects;
}

export interface PipelineAgentStepDefinition {
  id: string;
  use: string;
}

export interface PipelineApprovalStepDefinition {
  id: string;
  type: 'approval';
  input: string;
}

export interface PipelineParallelBranchDefinition {
  id: string;
  use: string;
}

export interface PipelineParallelStepDefinition {
  id: string;
  type: 'parallel';
  branches: PipelineParallelBranchDefinition[];
}

export type PipelineStepDefinition =
  | PipelineAgentStepDefinition
  | PipelineApprovalStepDefinition
  | PipelineParallelStepDefinition;

export interface PipelineDefinition {
  version: 2;
  id: string;
  title: string;
  primitives: Record<string, PipelinePrimitiveDefinition>;
  steps: PipelineStepDefinition[];
  source?: 'workspace' | 'team';
  filePath?: string;
  metadata?: CompiledTeamMetadata;
}

export interface PipelineValidationResult {
  definition?: PipelineDefinition;
  errors: string[];
}

const PIPELINE_DIR = path.join('.acp', 'pipelines');

export function getPipelineDefinitions(
  workspaceCwd: string = resolveWorkspaceIdentity().cwd,
  agentConfigs: Record<string, unknown> = readAgentConfigs(),
): PipelineDefinition[] {
  if (!isPipelineEnabled()) {
    return [];
  }
  const filePipelines = loadWorkspacePipelineDefinitions(workspaceCwd, agentConfigs);
  const teamPipelines = getValidTeamPipelines(workspaceCwd, agentConfigs);
  return mergePipelineDefinitions(filePipelines, teamPipelines, workspaceCwd);
}

export function getPipelineAgentNames(
  workspaceCwd: string = resolveWorkspaceIdentity().cwd,
  agentConfigs: Record<string, unknown> = readAgentConfigs(),
): string[] {
  return getPipelineDefinitions(workspaceCwd, agentConfigs).map(definition => definition.title);
}

export function getPipelineDefinitionForAgent(
  agentName: string,
  workspaceCwd: string = resolveWorkspaceIdentity().cwd,
  agentConfigs: Record<string, unknown> = readAgentConfigs(),
): PipelineDefinition | null {
  if (!isPipelineEnabled()) {
    return null;
  }

  const normalizedName = agentName.replace(/ \(invalid\)$/, '');
  const filePipeline = loadWorkspacePipelineDefinitions(workspaceCwd, agentConfigs)
    .find(definition => definition.title === normalizedName);
  const teamPipeline = getValidTeamPipelines(workspaceCwd, agentConfigs)
    .find(definition => definition.title === normalizedName);

  if (filePipeline && teamPipeline) {
    log(`Title conflict for "${normalizedName}": both pipeline file and team YAML define this agent. Pipeline file takes precedence.`);
  }

  return filePipeline ?? teamPipeline ?? null;
}

function mergePipelineDefinitions(
  filePipelines: PipelineDefinition[],
  teamPipelines: PipelineDefinition[],
  workspaceCwd: string,
): PipelineDefinition[] {
  const byTitle = new Map<string, PipelineDefinition>();

  for (const pipeline of filePipelines) {
    if (byTitle.has(pipeline.title)) {
      log(`Duplicate pipeline title "${pipeline.title}" in ${workspaceCwd}; keeping first definition.`);
      continue;
    }
    byTitle.set(pipeline.title, pipeline);
  }

  for (const pipeline of teamPipelines) {
    if (byTitle.has(pipeline.title)) {
      log(`Team "${pipeline.title}" conflicts with an existing pipeline title; team definition ignored.`);
      continue;
    }
    byTitle.set(pipeline.title, pipeline);
  }

  return [...byTitle.values()];
}

export function isPipelineVirtualAgentName(
  agentName: string,
  workspaceCwd: string = resolveWorkspaceIdentity().cwd,
  agentConfigs: Record<string, unknown> = readAgentConfigs(),
): boolean {
  return getPipelineDefinitionForAgent(agentName, workspaceCwd, agentConfigs) !== null;
}

export function loadWorkspacePipelineDefinitions(
  workspaceCwd: string,
  agentConfigs: Record<string, unknown>,
): PipelineDefinition[] {
  const dir = path.join(workspaceCwd, PIPELINE_DIR);
  if (!fs.existsSync(dir)) {
    return [];
  }

  let entries: string[];
  try {
    entries = fs.readdirSync(dir);
  } catch (e) {
    log(`Failed to read ACP pipeline directory ${dir}: ${e}`);
    return [];
  }

  const definitions: PipelineDefinition[] = [];
  for (const entry of entries.sort()) {
    if (!entry.endsWith('.yaml') && !entry.endsWith('.yml')) {
      continue;
    }
    const filePath = path.join(dir, entry);
    try {
      const text = fs.readFileSync(filePath, 'utf8');
      const result = parsePipelineYaml(text, filePath, agentConfigs);
      if (result.definition) {
        definitions.push(result.definition);
      } else {
        log(`Ignoring invalid ACP pipeline ${filePath}: ${result.errors.join('; ')}`);
      }
    } catch (e) {
      log(`Ignoring unreadable ACP pipeline ${filePath}: ${e}`);
    }
  }
  return definitions;
}

export function parsePipelineYaml(
  text: string,
  filePath: string,
  agentConfigs: Record<string, unknown>,
): PipelineValidationResult {
  let parsed: unknown;
  try {
    parsed = yaml.load(text);
  } catch (e: any) {
    return { errors: [`YAML parse error: ${e.message || String(e)}`] };
  }

  return validatePipelineDefinition(parsed, filePath, agentConfigs);
}

function readAgentConfigs(): Record<string, unknown> {
  return vscode.workspace.getConfiguration('acp').get<Record<string, unknown>>('agents', {});
}
