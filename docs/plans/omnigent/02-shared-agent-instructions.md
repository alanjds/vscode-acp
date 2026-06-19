# Plan Feature 02 - Instructions partagées par agent

## Inspiration Omnigent

Références :

- `docs/AGENT_YAML_SPEC.md`, champ `instructions` : https://github.com/omnigent-ai/omnigent/blob/main/docs/AGENT_YAML_SPEC.md
- README, agents personnalisés : https://github.com/omnigent-ai/omnigent#write-your-own-agent

Omnigent accepte un champ `instructions` qui peut pointer vers un fichier d'instructions, avec résolution relative au fichier YAML. Cette séparation rend les agents plus lisibles et facilite le partage de consignes longues.

## Parallèle avec l'existant dans ACP Client

ACP Client injecte déjà plusieurs types de contexte dans les prompts :

- le contexte éditeur via `src/ui/EditorContext.ts` ;
- le contexte partagé entre sessions via `src/core/DiscussionContextHandler.ts` ;
- les templates de prompts pipeline via `src/pipeline/PipelineGraphCompiler.ts`.

Ce qui manque est une source d'instructions stable et versionnée, indépendante du prompt utilisateur courant. Omnigent traite les instructions comme une partie structurelle de l'agent ; ACP Client traite aujourd'hui surtout le contexte comme un enrichissement dynamique de session.

Le parallèle direct est donc :

- Omnigent `instructions: file.md` -> fichier Markdown workspace résolu par un futur `InstructionResolver` ;
- injection Omnigent au démarrage de l'agent -> injection ACP Client au premier prompt ou lors de la création de session ;
- sécurité de résolution de chemin -> réutilisation de `src/security/SecurityPolicy.ts`.

## Objectif ACP Client

Supporter `instructions: path/to/file.md` dans les profils agents et, plus tard, dans les pipelines.

## Format cible

```yaml
version: 1
id: test-writer
title: Test Writer
agent: Codex CLI
instructions: .acp/instructions/test-writer.md
```

## Intégration dans le code local

Points d'entrée existants :

- `src/core/DiscussionContextHandler.ts` injecte déjà du contexte partagé au prompt.
- `src/ui/EditorContext.ts` construit du contexte éditeur.
- `src/pipeline/PipelineGraphCompiler.ts` rend déjà des templates de prompt.
- `src/security/SecurityPolicy.ts` valide les chemins workspace.

Changements proposés :

- Ajouter un `InstructionResolver` dédié.
- Résoudre les chemins relatifs depuis le YAML qui les déclare.
- Refuser les chemins hors workspace par défaut.
- Ajouter une limite de taille configurable pour éviter les prompts énormes.
- Injecter les instructions une seule fois au démarrage de session ou au premier prompt selon la capacité ACP disponible.

## UX

- Afficher une mention "Instructions: path" dans la bannière de session.
- Ajouter une action "Preview Final Prompt".
- Remonter les erreurs : fichier absent, chemin interdit, fichier trop gros.

## Risques

- Injection répétée des instructions à chaque prompt.
- Prompt trop volumineux sans feedback utilisateur.
- Chemins relatifs ambigus entre workspace, YAML et cwd.

## Découpage

1. Implémenter la résolution sécurisée des chemins.
2. Ajouter l'injection dans les profils agents.
3. Ajouter prévisualisation UI.
4. Etendre aux pipelines si utile.
