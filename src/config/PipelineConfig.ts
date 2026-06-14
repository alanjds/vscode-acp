import * as vscode from 'vscode';

export interface PipelineConfig {
  enabled: boolean;
}

export function getPipelineConfig(): PipelineConfig {
  const config = vscode.workspace.getConfiguration('acp');
  return {
    enabled: config.get<boolean>('pipeline.enabled', true),
  };
}

export function isPipelineEnabled(): boolean {
  return getPipelineConfig().enabled;
}
