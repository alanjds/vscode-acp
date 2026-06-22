export type SandcastleProviderName = 'codex' | 'cursor';

/** Configuration du bridge ACP Sandcastle (fournisseur, modèle, image Docker). */
export interface BridgeConfig {
  provider: SandcastleProviderName;
  model: string;
  effort?: 'low' | 'medium' | 'high' | 'xhigh';
  imageName: string;
}

/**
 * Analyse les arguments CLI et les variables d'environnement pour produire la configuration du bridge.
 *
 * @param argv - Arguments de ligne de commande (sans `node` ni le chemin du script).
 * @param env - Variables d'environnement du processus (notamment `ACP_SANDCASTLE_IMAGE`).
 * @returns Configuration validée du bridge Sandcastle.
 * @throws Si `--provider`, `--model` ou `--effort` sont absents ou invalides.
 */
export function parseBridgeConfig(argv: string[], env: NodeJS.ProcessEnv): BridgeConfig {
  const readArg = (name: string): string | undefined => {
    const index = argv.indexOf(name);
    return index >= 0 ? argv[index + 1] : undefined;
  };

  const provider = readArg('--provider');
  if (provider !== 'codex' && provider !== 'cursor') {
    throw new Error('Expected --provider codex|cursor.');
  }

  const model = readArg('--model')?.trim();
  if (!model) {
    throw new Error('Expected a non-empty --model value.');
  }

  const effort = readArg('--effort');
  if (effort && !['low', 'medium', 'high', 'xhigh'].includes(effort)) {
    throw new Error(`Unsupported effort value: ${effort}`);
  }

  return {
    provider,
    model,
    effort: effort as BridgeConfig['effort'],
    imageName: env.ACP_SANDCASTLE_IMAGE || 'acp-client-sandcastle:local',
  };
}
