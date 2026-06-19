# Plan Feature 08 - Sandboxing renforcé

## Inspiration Omnigent

Références :

- README, prérequis sandbox OS : https://github.com/omnigent-ai/omnigent#1-install
- `docs/AGENT_YAML_SPEC.md`, section `os_env` et `sandbox` : https://github.com/omnigent-ai/omnigent/blob/main/docs/AGENT_YAML_SPEC.md
- Source package : https://github.com/omnigent-ai/omnigent/tree/main/omnigent

Omnigent sélectionne un sandbox OS selon la plateforme, avec `bubblewrap` sur Linux et `seatbelt` sur macOS. ACP Client possède déjà un sandbox git worktree ; il faut le renforcer sans rendre l'expérience lourde.

## Parallèle avec l'existant dans ACP Client

ACP Client a déjà un sandbox produit utilisable :

- `src/sandbox/SandboxService.ts` crée les git worktrees ;
- `src/sandbox/SandboxApplyService.ts` applique le diff au workspace principal ;
- `src/sandbox/PromotionGate.ts` exécute lint/test et produit un rapport ;
- `src/sandbox/SandboxPromotionPanel.ts` expose Apply/Reject ;
- `src/sandbox/NetworkPolicy.ts` documente l'allowlist applicative.

Omnigent isole plus bas au niveau OS. ACP Client isole surtout les changements workspace et le flux de promotion. Pour ce plugin VS Code, la meilleure progression est de renforcer les contrôles applicatifs autour du sandbox existant avant de rendre une isolation OS optionnelle.

Le parallèle direct est donc :

- Omnigent OS sandbox -> option future, non bloquante ;
- Omnigent mounted workspace sandbox -> git worktree `.acp/sandboxes/*` ;
- Omnigent network restrictions -> `NetworkPolicy` et futures policies ;
- Omnigent review before merge -> `PromotionGate` déjà présent.

## Objectif ACP Client

Conserver le git worktree comme isolation principale, ajouter des garde-fous applicatifs plus stricts, et documenter clairement les limites.

## Etat local actuel

Fichiers existants :

- `src/sandbox/SandboxService.ts`
- `src/sandbox/SandboxApplyService.ts`
- `src/sandbox/PromotionGate.ts`
- `src/sandbox/NetworkPolicy.ts`
- `src/sandbox/sandboxedAgentRun.ts`
- `docs/adr/0011-agent-sandbox-worktree.md`

## Changements proposés

- Appliquer les policies terminal/fichier même dans le sandbox.
- Bloquer les accès fichiers hors sandbox au niveau handlers.
- Détecter certaines commandes qui changent de cwd hors sandbox.
- Rendre l'allowlist réseau visible dans l'UI.
- Ajouter un rapport "sandbox limitations" dans la promotion.
- Evaluer une isolation OS optionnelle plus tard, sans dépendance obligatoire.

## Format cible

```yaml
sandbox:
  enabled: true
  type: git-worktree
  network:
    allow:
      - github.com
      - registry.npmjs.org
  terminal:
    blockOutsideWorkspace: true
```

## UX

- Le panneau de promotion indique : fichiers modifiés, checks, réseau configuré, limites connues.
- Une alerte apparaît si aucune allowlist réseau n'est configurée.
- Les commandes rejetées expliquent quelle règle sandbox a bloqué.

## Risques

- Le parsing terminal ne garantit pas une isolation complète.
- Les agents qui lancent leurs propres sous-process peuvent contourner certains contrôles.
- Une isolation OS réelle serait plus robuste mais plus coûteuse en UX et maintenance.

## Découpage

1. Documentation claire des limites.
2. Policies sandbox appliquées aux handlers.
3. Rapport de promotion enrichi.
4. Evaluation technique OS sandbox optionnel.
