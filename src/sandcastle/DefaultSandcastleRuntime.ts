import {
  codex,
  createSandbox,
  cursor,
} from '@ai-hero/sandcastle';
import { docker } from '@ai-hero/sandcastle/sandboxes/docker';
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import type { BridgeConfig } from './BridgeConfig';
import type { SandcastleRuntime } from './SandcastleAcpAgent';

/** Writable Codex state dir for the sandbox; seeded once from host auth if present. */
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

function codexAuthMounts(repoDir: string): { hostPath: string; sandboxPath: string; readonly: boolean }[] {
  return [{
    hostPath: prepareCodexHome(repoDir),
    sandboxPath: '/home/agent/.codex',
    readonly: false,
  }];
}

export const defaultSandcastleRuntime: SandcastleRuntime = {
  createSandbox,
  createProvider(config: BridgeConfig) {
    if (config.provider === 'codex') {
      return codex(config.model, {
        effort: config.effort,
        captureSessions: false,
      });
    }
    return cursor(config.model);
  },
  createSandboxProvider(config: BridgeConfig, cwd: string) {
    return docker({
      imageName: config.imageName,
      cpus: 2,
      ...(config.provider === 'codex' ? { mounts: codexAuthMounts(cwd) } : {}),
    });
  },
};
