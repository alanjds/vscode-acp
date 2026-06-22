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

/**
 * Prépare un répertoire Codex inscriptible dans le sandbox, en copiant l'authentification hôte si nécessaire.
 *
 * @param repoDir - Racine du dépôt où créer `.sandcastle/codex-home`.
 * @returns Chemin absolu du répertoire `codex-home` du sandbox.
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

/**
 * Définit les montages Docker pour exposer l'état d'authentification Codex dans le conteneur sandbox.
 *
 * @param repoDir - Racine du dépôt servant de base au répertoire Codex préparé.
 * @returns Liste de montages host → sandbox pour le provider Codex.
 */
function codexAuthMounts(repoDir: string): { hostPath: string; sandboxPath: string; readonly: boolean }[] {
  return [{
    hostPath: prepareCodexHome(repoDir),
    sandboxPath: '/home/agent/.codex',
    readonly: false,
  }];
}

/** Runtime Sandcastle par défaut : sandbox Docker, providers Codex/Cursor et montages d'auth Codex. */
export const defaultSandcastleRuntime: SandcastleRuntime = {
  createSandbox,
  /**
   * Instancie le fournisseur d'agent (Codex ou Cursor) selon la configuration du bridge.
   *
   * @param config - Configuration du bridge (fournisseur, modèle, effort).
   * @returns Provider Sandcastle prêt à exécuter des prompts dans le sandbox.
   */
  createProvider(config: BridgeConfig) {
    if (config.provider === 'codex') {
      return codex(config.model, {
        effort: config.effort,
        captureSessions: false,
      });
    }
    return cursor(config.model);
  },
  /**
   * Configure le backend sandbox Docker (image, CPU, montages auth Codex si applicable).
   *
   * @param config - Configuration du bridge, notamment `imageName`.
   * @param cwd - Répertoire de travail du dépôt pour les montages Codex.
   * @returns Options sandbox passées à `createSandbox`.
   */
  createSandboxProvider(config: BridgeConfig, cwd: string) {
    return docker({
      imageName: config.imageName,
      cpus: 2,
      ...(config.provider === 'codex' ? { mounts: codexAuthMounts(cwd) } : {}),
    });
  },
};
