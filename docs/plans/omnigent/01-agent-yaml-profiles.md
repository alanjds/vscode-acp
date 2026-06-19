# Plan Feature 01 - Agents déclaratifs en YAML

## Inspiration Omnigent

Références :

- `docs/AGENT_YAML_SPEC.md` : https://github.com/omnigent-ai/omnigent/blob/main/docs/AGENT_YAML_SPEC.md
- README, section "Write your own agent" : https://github.com/omnigent-ai/omnigent#write-your-own-agent
- Source package : https://github.com/omnigent-ai/omnigent/tree/main/omnigent

Omnigent permet de lancer un agent depuis un fichier YAML contenant le nom, les instructions, l'executor, les outils, les sous-agents, l'accès OS, les terminaux et les policies. L'idée à reprendre n'est pas le runtime Python complet, mais le modèle déclaratif versionnable par repo.

## Parallèle avec l'existant dans ACP Client

ACP Client possède déjà deux mécanismes proches, mais séparés :

- les agents ACP classiques sont configurés dans les settings via `src/config/AgentConfig.ts` ;
- les pipelines virtuels sont chargés depuis `.acp/pipelines/*.yaml` via `src/config/PipelineCatalog.ts`.

Omnigent combine ces deux idées dans un fichier agent autonome. Le plugin actuel sait déjà charger du YAML workspace, valider des agents référencés et exposer des agents virtuels dans la tree view. La différence principale est qu'un pipeline ACP Client décrit aujourd'hui un workflow, alors qu'un profil agent Omnigent décrit une identité d'agent réutilisable.

Le parallèle direct est donc :

- Omnigent `agent.yaml` -> nouveau `.acp/agents/*.yaml` ;
- Omnigent `executor` -> `agent` qui référence une entrée `acp.agents` existante ;
- Omnigent `instructions` -> injection dans le prompt via `DiscussionContextHandler` ou couche profil ;
- Omnigent `tools/policies/sandbox` -> futures extensions vers handlers et sandbox existants.

## Objectif ACP Client

Ajouter des profils agents locaux dans `.acp/agents/*.yaml`, affichés comme agents virtuels dans la vue Agents.

Les profils doivent permettre de :

- définir un agent spécialisé par workspace ;
- référencer un agent ACP existant comme runtime ;
- définir prompt, instructions, cwd, mode, modèle, permissions et sandbox ;
- versionner ces profils avec le code du projet ;
- éviter de surcharger les settings VS Code globaux.

## Format cible

```yaml
version: 1
id: code-reviewer
title: Code Reviewer
agent: Codex CLI
instructions: .acp/agents/code-reviewer.md
model: gpt-5
mode: review
workingDirectory: .
permissions:
  fileSystem: ask
  terminal: ask
sandbox:
  enabled: true
```

## Intégration dans le code local

Points d'entrée existants :

- `src/config/PipelineCatalog.ts` charge déjà des YAML workspace.
- `src/config/PipelineConfig.ts` contient des patterns de validation YAML.
- `src/core/AgentManager.ts` agrège les agents disponibles.
- `src/ui/SessionTreeProvider.ts` expose les agents dans la tree view.
- `src/core/SessionManager.ts` connecte et restaure les sessions.

Changements proposés :

- Créer `src/config/AgentProfileConfig.ts` pour les types et la validation.
- Créer `src/config/AgentProfileCatalog.ts` pour charger `.acp/agents/*.yaml`.
- Ajouter un watcher dans `src/extension.ts` sur `**/.acp/agents/*.yaml`.
- Fusionner agents configurés, pipelines virtuels et profils agents dans `AgentManager`.
- Ajouter des tests unitaires autour du chargement, des erreurs et de la priorité des overrides.

## UX

- Dans la vue Agents, afficher les profils avec une icône distincte.
- En cas d'erreur YAML, afficher l'agent en erreur plutôt que le masquer silencieusement.
- Ajouter une commande contextuelle "Open Agent Profile".
- Afficher le runtime ACP réel utilisé par le profil.

## Risques

- Ambiguïté entre agent ACP configuré et profil local portant le même nom.
- Prompt final difficile à comprendre si plusieurs sources sont fusionnées.
- Divergence entre options déclarées et options réellement supportées par l'agent ACP.

## Découpage

1. Lire et valider `.acp/agents/*.yaml`.
2. Afficher les profils dans la tree view.
3. Connecter un profil à son agent ACP cible.
4. Injecter instructions et options au premier prompt.
5. Ajouter documentation et exemples.

## Réflexion sur les runtimes CLI et les adaptateurs

Les CLI déjà configurés dans ACP Client doivent être considérés comme les primitives d'exécution sur lesquelles les profils YAML construisent des agents spécialisés.

Un profil agent ne remplace donc pas un CLI et ne décrit pas un nouveau runtime complet. Il référence un agent ACP existant, par exemple `Codex CLI`, puis ajoute une couche déclarative locale : identité, instructions, répertoire de travail, mode, modèle, permissions et sandbox.

Le premier niveau d'intégration devrait rester générique :

- résoudre `agent` vers une entrée `acp.agents` existante ;
- charger les instructions depuis le fichier référencé ;
- appliquer le `workingDirectory` ;
- injecter les instructions et options supportées au démarrage de la discussion ;
- afficher le profil comme agent virtuel dans l'interface.

Ce niveau générique permet de traiter tous les CLI de manière uniforme, sans introduire immédiatement un adaptateur spécifique par runtime.

Une option de cadrage plus simple serait aussi de limiter volontairement cette feature à une ou deux CLI bien supportées au départ, par exemple `pi` et `vibe`, plutôt que de chercher une compatibilité immédiate avec tous les agents ACP configurables. Si ces CLI couvrent déjà la majorité des fournisseurs de modèles via leurs providers internes, l'effort d'adaptation reste faible. Le cas Mistral, ou tout provider non couvert par ces CLI, pourrait alors être traité comme une exception explicite plutôt que comme une contrainte structurante du format YAML dès la première version.

Point de décision v1 :

- Si l'analyse d'implémentation montre qu'un vrai profil agent nécessite de modifier le prompt système natif, et pas seulement d'ajouter des instructions dans le premier prompt, la v1 doit être centrée sur `pi Agent`. Le CLI `pi` supporte explicitement `--system-prompt` et `--append-system-prompt`, ce qui en fait le runtime le plus adapté pour valider les agents YAML, les rôles spécialisés et les instructions partagées sans écrire tout de suite des adaptateurs profonds pour chaque agent ACP.

Un second niveau d'adaptation sera probablement nécessaire lorsque les options déclarées ne correspondent pas directement aux capacités de tous les CLI. Par exemple, `model`, `mode`, `sandbox` ou `permissions` peuvent avoir une traduction native pour certains runtimes et être seulement gérés côté extension pour d'autres.

La customisation devrait donc être progressive :

- options communes et portables dans le format principal : `id`, `title`, `agent`, `instructions`, `workingDirectory`, `permissions`, `sandbox` ;
- options semi-portables avec validation de support : `model`, `mode` ;
- options spécifiques à un runtime dans une section dédiée future, par exemple :

```yaml
runtimeOptions:
  codex:
    approvalPolicy: on-request
    reasoningEffort: high
```

Cette séparation évite de polluer le format principal avec des options propres à un seul CLI. Le YAML reste déclaratif et versionnable, tandis qu'une couche d'adaptation traduit progressivement ce profil vers les capacités concrètes du runtime cible.
