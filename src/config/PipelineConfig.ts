import * as vscode from 'vscode';

export const DEFAULT_PIPELINE_VIRTUAL_AGENT_NAME = 'Codex Plan -> Vibe Implement';
export const DEFAULT_PIPELINE_PLANNER_AGENT_NAME = 'Codex CLI';
export const DEFAULT_PIPELINE_IMPLEMENTER_AGENT_NAME = 'Vibe';

export const DEFAULT_GEMINI_PIPELINE_VIRTUAL_AGENT_NAME = 'Gemini Plan -> Vibe Implement';
export const DEFAULT_GEMINI_PIPELINE_PLANNER_AGENT_NAME = 'Gemini CLI';
export const DEFAULT_GEMINI_PIPELINE_IMPLEMENTER_AGENT_NAME = 'Vibe';

export interface PipelineConfig {
  enabled: boolean;
  virtualAgentName: string;
  plannerAgentName: string;
  implementerAgentName: string;
}

export interface GeminiPipelineConfig {
  virtualAgentName: string;
  plannerAgentName: string;
  implementerAgentName: string;
}

export function getPipelineConfig(): PipelineConfig {
  const config = vscode.workspace.getConfiguration('acp');
  return {
    enabled: config.get<boolean>('pipeline.enabled', true),
    virtualAgentName: config.get<string>(
      'pipeline.virtualAgentName',
      DEFAULT_PIPELINE_VIRTUAL_AGENT_NAME,
    ).trim() || DEFAULT_PIPELINE_VIRTUAL_AGENT_NAME,
    plannerAgentName: config.get<string>(
      'pipeline.plannerAgentName',
      DEFAULT_PIPELINE_PLANNER_AGENT_NAME,
    ).trim() || DEFAULT_PIPELINE_PLANNER_AGENT_NAME,
    implementerAgentName: config.get<string>(
      'pipeline.implementerAgentName',
      DEFAULT_PIPELINE_IMPLEMENTER_AGENT_NAME,
    ).trim() || DEFAULT_PIPELINE_IMPLEMENTER_AGENT_NAME,
  };
}

export function getGeminiPipelineConfig(): GeminiPipelineConfig {
  const config = vscode.workspace.getConfiguration('acp');
  return {
    virtualAgentName: config.get<string>(
      'pipeline.geminiVirtualAgentName',
      DEFAULT_GEMINI_PIPELINE_VIRTUAL_AGENT_NAME,
    ).trim() || DEFAULT_GEMINI_PIPELINE_VIRTUAL_AGENT_NAME,
    plannerAgentName: config.get<string>(
      'pipeline.geminiPlannerAgentName',
      DEFAULT_GEMINI_PIPELINE_PLANNER_AGENT_NAME,
    ).trim() || DEFAULT_GEMINI_PIPELINE_PLANNER_AGENT_NAME,
    implementerAgentName: config.get<string>(
      'pipeline.geminiImplementerAgentName',
      DEFAULT_GEMINI_PIPELINE_IMPLEMENTER_AGENT_NAME,
    ).trim() || DEFAULT_GEMINI_PIPELINE_IMPLEMENTER_AGENT_NAME,
  };
}

export function isPipelineEnabled(): boolean {
  return getPipelineConfig().enabled;
}

export function getPipelineVirtualAgentName(): string {
  return getPipelineConfig().virtualAgentName;
}

export function isPipelineVirtualAgentName(agentName: string): boolean {
  const pipeline = getPipelineConfig();
  const geminiPipeline = getGeminiPipelineConfig();
  return (
    pipeline.enabled &&
    (agentName === pipeline.virtualAgentName || agentName === geminiPipeline.virtualAgentName)
  );
}

export function getPipelineConfigForAgent(agentName: string): PipelineConfig | GeminiPipelineConfig | null {
  const pipeline = getPipelineConfig();
  const geminiPipeline = getGeminiPipelineConfig();

  if (agentName === pipeline.virtualAgentName) {
    return pipeline;
  }
  if (agentName === geminiPipeline.virtualAgentName) {
    return geminiPipeline;
  }
  return null;
}

export function getGeminiPipelineVirtualAgentName(): string {
  return getGeminiPipelineConfig().virtualAgentName;
}
