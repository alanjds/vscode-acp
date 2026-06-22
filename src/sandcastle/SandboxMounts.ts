import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import type { BridgeConfig } from './BridgeConfig';

/**
 * Prépare un répertoire Codex inscriptible dans le sandbox, en copiant l'authentification hôte si nécessaire.
 */
export function prepareCodexHome(repoDir: string): string {
  const codexHome = join(repoDir, '.sandcastle', 'codex-home');
  mkdirSync(codexHome, { recursive: true });
  const hostAuth = join(homedir(), '.codex', 'auth.json');
  const sandboxAuth = join(codexHome, 'auth.json');
  if (existsSync(hostAuth) && !existsSync(sandboxAuth)) {
    copyFileSync(hostAuth, sandboxAuth);
  }
  return codexHome;
}

export function codexAuthMounts(repoDir: string): { hostPath: string; sandboxPath: string; readonly: boolean }[] {
  return [{
    hostPath: prepareCodexHome(repoDir),
    sandboxPath: '/home/agent/.codex',
    readonly: false,
  }];
}

export function agentsSkillsMounts(repoDir: string): { hostPath: string; sandboxPath: string; readonly: boolean }[] {
  const agentsDir = join(repoDir, '.agents');
  if (!existsSync(agentsDir)) {
    return [];
  }

  return [{
    hostPath: agentsDir,
    sandboxPath: '.agents',
    readonly: false,
  }];
}

export function buildSandboxMounts(
  config: BridgeConfig,
  cwd: string,
): { hostPath: string; sandboxPath: string; readonly: boolean }[] {
  const mounts = [...agentsSkillsMounts(cwd)];
  if (config.provider === 'codex') {
    mounts.push(...codexAuthMounts(cwd));
  }
  return mounts;
}
