import * as vscode from 'vscode';

export interface SandboxPromotionConfig {
  lintCommand: string;
  testCommand: string;
  requireChecksPass: boolean;
}

export interface SandboxConfig {
  enabled: boolean;
  directory: string;
  baseBranch: string;
  autoCleanupOnReject: boolean;
  staleTtlMs: number;
  promotion: SandboxPromotionConfig;
  networkAllowlist: string[];
}

const DEFAULT_STALE_TTL_MS = 24 * 60 * 60 * 1000;

export function getSandboxConfig(): SandboxConfig {
  const config = vscode.workspace.getConfiguration('acp.sandbox');
  return {
    enabled: config.get<boolean>('enabled', false),
    directory: config.get<string>('directory', '.acp/sandboxes') || '.acp/sandboxes',
    baseBranch: config.get<string>('baseBranch', '') || '',
    autoCleanupOnReject: config.get<boolean>('autoCleanupOnReject', true),
    staleTtlMs: config.get<number>('staleTtlMs', DEFAULT_STALE_TTL_MS),
    promotion: {
      lintCommand: config.get<string>('promotion.lintCommand', '') || '',
      testCommand: config.get<string>('promotion.testCommand', '') || '',
      requireChecksPass: config.get<boolean>('promotion.requireChecksPass', false),
    },
    networkAllowlist: config.get<string[]>('network.allowlist', []) ?? [],
  };
}

export function isSandboxEnabled(): boolean {
  return getSandboxConfig().enabled;
}
