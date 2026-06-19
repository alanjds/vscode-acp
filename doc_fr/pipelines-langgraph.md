# Pipelines LangGraph ACP

Cette page explique le nouveau fonctionnement des pipelines ACP Client : un pipeline est un fichier YAML du workspace, compilé en graphe LangGraph, dont les nodes appellent des agents ACP configurés dans VS Code.

L'objectif est de décrire des workflows lisibles comme :

```text
plan -> approbation humaine -> exécution -> vérification
```

ou, plus tard :

```text
plan -> recherches parallèles -> synthèse -> approbation -> exécution -> vérification
```

## Vue d'ensemble

ACP et LangGraph ont deux rôles distincts :

- ACP reste le protocole de communication avec les agents de coding.
- LangGraph orchestrate le workflow : ordre des étapes, parallélisation, état, approbation humaine et reprise après approbation.
- Le DSL YAML décrit le workflow de façon lisible dans le repo.

> **Note** : Les **Équipes d'agents** (Agent Teams) offrent une manière déclarative de définir des workflows basés sur des rôles qui se compilent en pipeline v2. Voir [agent-teams.md](./agent-teams.md) pour le format complet.

Le flux global est :

```text
VS Code / ACP Client
  -> agent virtuel de pipeline
  -> PipelineService
  -> graphe LangGraph compilé depuis YAML
  -> primitives ACP
  -> résultat streamé dans le chat VS Code
```

Un pipeline valide apparaît comme un agent virtuel dans la vue Agents. L'utilisateur discute avec cet agent virtuel comme avec un agent normal.

## Pré-requis

1. `acp.pipeline.enabled` doit être à `true`.
2. Le fichier YAML doit être dans `.acp/pipelines`.
3. Le YAML doit utiliser `version: 2`.
4. Chaque agent référencé par `primitives.*.agent` doit exister dans `acp.agents`.
5. Les agents qui modifient le workspace doivent rester après une étape `approval`.

Exemple de configuration d'agents attendue :

```json
{
  "acp.agents": {
    "Codex CLI": {
      "command": "npx",
      "args": ["@zed-industries/codex-acp@latest"],
      "env": {}
    },
    "Vibe": {
      "command": "vibe-acp",
      "args": [],
      "env": {}
    }
  }
}
```

## Où déclarer un pipeline

Les pipelines sont chargés depuis :

```text
.acp/pipelines/*.yaml
.acp/pipelines/*.yml
```

Le champ `title` devient le nom affiché dans la vue Agents.

Exemple :

```yaml
version: 2
id: plan-execute-verify
title: Plan Execute Verify
```

Dans VS Code, l'agent virtuel s'appellera `Plan Execute Verify`.

## Catalogue de workflows

Le repo contient maintenant un catalogue plus large de workflows prêts à tester :

```text
doc_fr/pipelines-workflows-catalog.md
```

Il couvre notamment les démos simples, les audits read-only, les flows avec approbation, et les patterns créatifs de réconciliation multi-edit.

## Démo simple

Pour tester le mécanisme sans modifier le workspace, le repo fournit :

```text
.acp/pipelines/demo-simple.yaml
```

Ce flow fait seulement deux étapes read-only :

```text
analyse de la demande -> réponse courte
```

```yaml
version: 2
id: demo-simple
title: Demo Simple

primitives:
  analyze_request:
    agent: Codex CLI
    output: markdown
    sideEffects: none
    prompt: |
      Analyse la demande utilisateur en trois points courts :
      - objectif
      - contexte utile
      - prochaine action recommandée

      Demande utilisateur :
      {{userPrompt}}

  write_answer:
    agent: Codex CLI
    output: markdown
    sideEffects: none
    prompt: |
      Rédige une réponse courte et actionnable à partir de l'analyse.

      Demande utilisateur :
      {{userPrompt}}

      Analyse :
      {{steps.analyze.output}}

steps:
  - id: analyze
    use: analyze_request

  - id: answer
    use: write_answer
```

Rechargez VS Code si nécessaire puis sélectionnez l'agent virtuel `Demo Simple` dans la vue Agents. Exemple de prompt à envoyer :

```text
Explique-moi comment lancer les tests du projet.
```

Le résultat attendu est un seul échange streamé dans le chat : d'abord l'analyse produite par `analyze`, puis la réponse finale produite par `answer`.

## Démo parallèle

Pour tester un vrai step parallèle sans modifier le workspace, le repo fournit aussi :

```text
.acp/pipelines/demo-parallel-review.yaml
```

Ce flow est utile pour préparer une réponse ou un plan avant de toucher au code. Il découpe la demande en deux analyses lancées en même temps :

```text
cadrage -> analyse code + analyse tests/docs en parallèle -> synthèse
```

```yaml
version: 2
id: demo-parallel-review
title: Demo Parallel Review

primitives:
  scope_request:
    agent: Codex CLI
    output: markdown
    sideEffects: none
    prompt: |
      Résume la demande utilisateur en trois lignes maximum.
      Indique aussi les zones du projet qui semblent probablement concernées.

      Demande utilisateur :
      {{userPrompt}}

  inspect_code:
    agent: Codex CLI
    output: markdown
    sideEffects: none
    prompt: |
      Analyse uniquement l'impact code probable de cette demande.
      Ne modifie aucun fichier.
      Retourne :
      - fichiers ou dossiers à regarder
      - risques techniques
      - questions ouvertes

      Demande utilisateur :
      {{userPrompt}}

      Résumé initial :
      {{steps.scope.output}}

  inspect_tests_docs:
    agent: Codex CLI
    output: markdown
    sideEffects: none
    prompt: |
      Analyse uniquement l'impact tests et documentation de cette demande.
      Ne modifie aucun fichier.
      Retourne :
      - tests à lancer ou à ajouter
      - documentation à mettre à jour
      - critères de validation

      Demande utilisateur :
      {{userPrompt}}

      Résumé initial :
      {{steps.scope.output}}

  synthesize_review:
    agent: Codex CLI
    output: markdown
    sideEffects: none
    prompt: |
      Produit une synthèse courte et actionnable à partir des deux analyses parallèles.
      Structure la réponse avec :
      - décision recommandée
      - prochaines actions
      - validations à faire

      Demande utilisateur :
      {{userPrompt}}

      Impact code :
      {{steps.investigation.branches.code.output}}

      Tests et documentation :
      {{steps.investigation.branches.tests_docs.output}}

steps:
  - id: scope
    use: scope_request

  - id: investigation
    type: parallel
    branches:
      - id: code
        use: inspect_code
      - id: tests_docs
        use: inspect_tests_docs

  - id: synthesize
    use: synthesize_review
```

Exemple de prompt à envoyer à l'agent virtuel `Demo Parallel Review` :

```text
Je veux ajouter un bouton pour relancer le dernier pipeline échoué.
```

Les branches `code` et `tests_docs` tournent en parallèle, puis `synthesize` récupère leurs deux sorties avec :

```yaml
{{steps.investigation.branches.code.output}}
{{steps.investigation.branches.tests_docs.output}}
```

## Exemple fourni

Le repo contient un exemple dans :

```text
.acp/pipelines/plan-execute-verify.yaml
```

Il fait quatre choses :

1. `plan` demande à `Codex CLI` de produire un plan.
2. `approval` affiche ce plan dans le chat pour validation humaine.
3. `implement` envoie le plan approuvé à `Vibe` pour modifier le workspace.
4. `verify` demande à `Codex CLI` de vérifier le résultat.

```yaml
version: 2
id: plan-execute-verify
title: Plan Execute Verify

primitives:
  planner:
    agent: Codex CLI
    output: proposed_plan
    sideEffects: none
    prompt: |
      Create a decision-complete implementation plan only.
      Return exactly one <proposed_plan> block.

      User request:
      {{userPrompt}}

  implementer:
    agent: Vibe
    output: markdown
    sideEffects: workspace
    prompt: |
      Implement the approved plan in the current workspace.

      Original request:
      {{userPrompt}}

      Approved plan:
      {{steps.approval.output}}

  verifier:
    agent: Codex CLI
    output: markdown
    sideEffects: none
    prompt: |
      Verify whether the approved plan was completed.
      Include changed files, tests, risks, and remaining gaps.

      Original request:
      {{userPrompt}}

      Approved plan:
      {{steps.approval.output}}

      Implementation output:
      {{steps.implement.output}}

steps:
  - id: plan
    use: planner

  - id: approval
    type: approval
    input: "{{steps.plan.output}}"

  - id: implement
    use: implementer

  - id: verify
    use: verifier
```

## Structure du DSL

Un pipeline contient deux blocs principaux :

```yaml
primitives:
  ...

steps:
  ...
```

`primitives` définit les unités de travail disponibles.

`steps` définit l'ordre d'exécution du workflow.

### Primitive

Une primitive est une tâche agent ACP :

```yaml
planner:
  agent: Codex CLI
  output: proposed_plan
  sideEffects: none
  prompt: |
    ...
```

Champs :

- `agent` : nom exact d'un agent dans `acp.agents`.
- `output` : `markdown` ou `proposed_plan`.
- `sideEffects` : `none` ou `workspace`.
- `prompt` : prompt envoyé à l'agent ACP.

### Step agent

Un step agent appelle une primitive :

```yaml
- id: plan
  use: planner
```

`id` sert ensuite dans les templates :

```yaml
{{steps.plan.output}}
```

### Step approval

Un step d'approbation met LangGraph en pause :

```yaml
- id: approval
  type: approval
  input: "{{steps.plan.output}}"
```

Le chat affiche le plan. L'utilisateur peut :

- modifier le plan ;
- approuver ;
- rejeter.

Si l'utilisateur approuve, LangGraph reprend avec le plan modifié. Si l'utilisateur rejette, le pipeline s'arrête.

### Step parallèle

Un step parallèle lance plusieurs branches read-only en même temps :

```yaml
- id: investigation
  type: parallel
  branches:
    - id: repo
      use: repo_search
    - id: tests
      use: test_search
```

Les branches doivent utiliser des primitives avec :

```yaml
sideEffects: none
```

Les outputs se référencent ensuite avec :

```yaml
{{steps.investigation.branches.repo.output}}
{{steps.investigation.branches.tests.output}}
```

## Variables de template

Variables supportées :

```text
{{userPrompt}}
{{steps.<stepId>.output}}
{{steps.<parallelStepId>.branches.<branchId>.output}}
```

Exemple :

```yaml
prompt: |
  Original request:
  {{userPrompt}}

  Approved plan:
  {{steps.approval.output}}

  Implementation output:
  {{steps.implement.output}}
```

Les références vers un step futur sont rejetées à la validation.

## Règles de sécurité

Le validateur applique ces règles :

- `version` doit valoir `2`.
- Les ids de steps doivent être uniques.
- Les ids de branches doivent être uniques dans un step parallèle.
- Une primitive `sideEffects: workspace` est interdite avant une étape `approval`.
- Une primitive `sideEffects: workspace` est interdite dans un step `parallel`.
- Une primitive `output: proposed_plan` doit retourner exactement un bloc `<proposed_plan>...</proposed_plan>`.
- Un plan approuvé doit contenir uniquement ce bloc, sans texte avant ni après.

Cette règle protège le workspace : tout ce qui peut modifier les fichiers doit passer après une approbation humaine explicite.

## Comment l'utiliser dans VS Code

1. Créer ou modifier un fichier dans `.acp/pipelines`.
2. Vérifier que les agents indiqués existent dans `acp.agents`.
3. Recharger la fenêtre VS Code si l'agent virtuel n'apparaît pas immédiatement.
4. Ouvrir la vue ACP Client.
5. Sélectionner l'agent virtuel dont le nom correspond au `title` du YAML.
6. Envoyer la demande dans le chat.
7. Relire le plan proposé.
8. Modifier le plan si nécessaire.
9. Cliquer sur approve pour continuer, ou reject pour arrêter.
10. Lire le résultat d'exécution et la vérification dans le même chat.

## Exemple avec recherche parallèle

Ce pattern est utile pour préparer un plan plus robuste avant approbation :

```yaml
version: 2
id: refactor-with-investigation
title: Refactor With Investigation

primitives:
  planner:
    agent: Codex CLI
    output: proposed_plan
    sideEffects: none
    prompt: |
      Propose a plan.
      {{userPrompt}}

  repo_search:
    agent: Codex CLI
    output: markdown
    sideEffects: none
    prompt: |
      Inspect relevant code for:
      {{steps.planner.output}}

  test_search:
    agent: Codex CLI
    output: markdown
    sideEffects: none
    prompt: |
      Find relevant tests for:
      {{steps.planner.output}}

  synthesize:
    agent: Codex CLI
    output: proposed_plan
    sideEffects: none
    prompt: |
      Produce the final plan from:

      Initial plan:
      {{steps.planner.output}}

      Repo findings:
      {{steps.investigation.branches.repo.output}}

      Test findings:
      {{steps.investigation.branches.tests.output}}

steps:
  - id: planner
    use: planner

  - id: investigation
    type: parallel
    branches:
      - id: repo
        use: repo_search
      - id: tests
        use: test_search

  - id: synthesize
    use: synthesize

  - id: approval
    type: approval
    input: "{{steps.synthesize.output}}"
```

## Erreurs fréquentes

| Message ou symptôme | Cause probable | Correction |
|---------------------|----------------|------------|
| L'agent virtuel n'apparaît pas | YAML invalide, mauvais dossier, ou `acp.pipeline.enabled` à `false`. | Vérifier `.acp/pipelines`, les logs ACP et le setting. |
| `Missing configured ACP pipeline agent(s)` | Un nom dans `agent:` n'existe pas dans `acp.agents`. | Corriger le YAML ou ajouter l'agent dans les settings. |
| `version must be 2` | Ancien DSL v1 ou champ absent. | Passer le fichier au format v2. |
| `workspace side effects before an approval step` | Une étape qui modifie le workspace est placée avant approbation. | Déplacer cette étape après `type: approval`. |
| `cannot use workspace side effects` dans un parallèle | Une branche parallèle essaie de modifier le workspace. | Garder les branches parallèles en read-only. |
| `expected exactly one proposed_plan` | L'agent n'a pas retourné un seul bloc `<proposed_plan>`. | Renforcer le prompt ou changer `output` en `markdown` si ce n'est pas un plan. |

## Équipes d'agents (Agent Teams)

Pour les workflows orientés rôles (planifier → implémenter → relire), les **Équipes d'agents** fournissent une syntaxe plus simple que le DSL pipeline complet.

### Avantages des équipes

- Définition déclarative des rôles dans `.acp/teams/*.yaml`
- Compilation automatique vers pipeline v2
- Pas besoin d'apprendre tout le DSL pipeline
- Instructions séparées par fichier pour chaque rôle

### Exemple minimal

```yaml
version: 1
id: mon-equipe
title: Mon Équipe
roles:
  planner:
    agent: Codex CLI
    instructions: .acp/agents/planner.md
  implementer:
    agent: Vibe
    instructions: .acp/agents/implementer.md
  reviewer:
    agent: Claude Code
    instructions: .acp/agents/reviewer.md
```

Les équipes apparaissent comme des agents virtuels dans la vue Agents, avec une icône d'organisation.

### Erreurs fréquentes avec les équipes

| Message ou symptôme | Cause probable | Correction |
|---------------------|----------------|------------|
| `Titre (invalide)` dans la vue Agents | YAML invalide ou rôle manquant | Vérifier l'infobulle pour l'erreur, corriger le fichier team |
| Équipe n'apparaît pas | `acp.pipeline.enabled` à `false` ou fichier hors `.acp/teams/` | Activer le setting, déplacer le fichier |
| `roles.planner is required` | Rôle planner manquant | Ajouter le rôle planner avec agent et instructions |
| `roles.<rôle>.agent references missing ACP agent` | Agent non configuré dans `acp.agents` | Ajouter l'agent dans les paramètres |
| `roles.<rôle>.instructions could not be resolved` | Fichier d'instructions introuvable | Créer le fichier ou corriger le chemin |

Voir la [documentation complète des Équipes d'agents](./agent-teams.md) pour plus de détails.

## Quand créer plusieurs pipelines

Créer plusieurs fichiers YAML quand les workflows ont des objectifs différents :

- `plan-execute-verify.yaml` pour le flux standard.
- `refactor-with-investigation.yaml` pour les gros refactors.
- `review-only.yaml` pour un pipeline qui analyse sans modifier.
- `docs-update.yaml` pour documenter après implémentation.

Chaque fichier crée un agent virtuel séparé dans la vue Agents.
