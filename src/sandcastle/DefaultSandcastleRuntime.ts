import {
  codex,
  createSandbox,
  cursor,
} from '@ai-hero/sandcastle';
import { docker } from '@ai-hero/sandcastle/sandboxes/docker';

import type { BridgeConfig } from './BridgeConfig';
import type { SandcastleRuntime } from './SandcastleAcpAgent';
import { buildSandboxMounts } from './SandboxMounts';

export { prepareCodexHome } from './SandboxMounts';

/** Runtime Sandcastle par défaut : sandbox Docker, providers Codex/Cursor et montages d'auth Codex. */
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
      mounts: buildSandboxMounts(config, cwd),
    });
  },
};
