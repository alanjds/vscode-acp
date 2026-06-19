# Plan Feature 03 - Sous-agents et reviewers déclaratifs

## Inspiration Omnigent

Références :

- `docs/AGENT_YAML_SPEC.md`, section "Sub-agent tool" : https://github.com/omnigent-ai/omnigent/blob/main/docs/AGENT_YAML_SPEC.md
- README, exemple Polly : https://github.com/omnigent-ai/omnigent#polly-and-debby
- Exemples Omnigent : https://github.com/omnigent-ai/omnigent/tree/main/examples

Omnigent présente Polly comme un orchestrateur qui planifie, délègue à des agents de code en worktrees parallèles, puis route les diffs vers un reviewer d'un autre fournisseur. ACP Client a déjà un DSL pipeline ; l'inspiration à reprendre est la déclaration simple des rôles.

## Parallèle avec l'existant dans ACP Client

ACP Client couvre déjà une partie de Polly avec le système pipeline :

- `src/pipeline/PipelineGraphCompiler.ts` compile les étapes YAML ;
- `src/pipeline/PipelineService.ts` exécute le workflow ;
- `src/pipeline/AcpAgentRunner.ts` délègue à un agent ACP ;
- `src/sandbox/sandboxedAgentRun.ts` et `src/sandbox/SandboxService.ts` isolent les étapes workspace ;
- `docs/pipeline-a2a.md` décrit déjà plan, approval, implement et parallel.

La différence est ergonomique : le DSL actuel décrit des primitives et des steps, alors qu'Omnigent expose des rôles compréhensibles par l'utilisateur. ACP Client n'a pas besoin d'un nouveau moteur d'orchestration pour cette feature ; il doit ajouter une couche de compilation déclarative `roles -> pipeline`.

Le parallèle direct est donc :

- Omnigent sub-agent tool -> rôle pipeline ACP ;
- Omnigent reviewer externe -> étape `reviewer` ACP après implémentation ;
- Omnigent worktrees parallèles -> sandbox git worktree déjà présent ;
- Omnigent orchestration Polly -> profil local qui génère un pipeline v2.

## Objectif ACP Client

Ajouter une syntaxe de rôles qui compile vers les pipelines existants.

## Format cible

```yaml
version: 1
id: feature-team
title: Feature Team
orchestrator:
  agent: Codex CLI
roles:
  planner:
    agent: Codex CLI
    instructions: .acp/agents/planner.md
  implementer:
    agent: Vibe
    instructions: .acp/agents/implementer.md
    sideEffects: workspace
  reviewer:
    agent: Claude Code
    instructions: .acp/agents/reviewer.md
```

## Intégration dans le code local

Points d'entrée existants :

- `src/pipeline/PipelineGraphCompiler.ts` compile déjà steps, approvals et parallel.
- `src/pipeline/PipelineService.ts` orchestre les runs.
- `src/pipeline/AcpAgentRunner.ts` lance les agents ACP.
- `src/sandbox/sandboxedAgentRun.ts` sait isoler les étapes workspace.
- `webview/src/components/PipelinePlanBlock.tsx` affiche les plans.

Changements proposés :

- Créer un compilateur `AgentTeamCompiler` vers le DSL pipeline v2.
- Générer automatiquement les étapes : plan, approval, implement, review, optional test.
- Ajouter `role` et `agentName` aux updates pipeline pour améliorer l'affichage.
- Interdire `sideEffects: workspace` avant une étape d'approbation.
- Forcer le sandbox pour les rôles workspace si `acp.sandbox.enabled` est actif.

## UX

- Afficher les rôles comme une timeline : Planner, Approval, Implementer, Reviewer.
- Donner accès aux sorties de chaque rôle sans mélanger les sessions internes.
- Permettre de relancer uniquement le reviewer sur le dernier diff.

## Risques

- Trop de magie si le YAML génère un pipeline implicite difficile à déboguer.
- Gestion complexe de l'annulation si plusieurs sous-runs sont actifs.
- Confusion entre sessions utilisateur et sessions internes pipeline.

## Découpage

1. Définir le schéma `roles`.
2. Compiler vers DSL pipeline v2.
3. Ajouter affichage des rôles.
4. Ajouter tests sur sécurité et ordre des étapes.
