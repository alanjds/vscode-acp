# Plan : workflows paralleles pour les pipelines YAML

## Resume

Etendre les pipelines YAML primitive-first avec une premiere forme de parallelisme simple, lisible et sure : un bloc `type: parallel` explicite qui lance plusieurs branches independantes, attend leurs resultats, puis reprend le flux lineaire.

Le choix conseille est de livrer d'abord le fan-out/fan-in explicite, limite aux primitives sans effet de bord workspace. Le DAG libre avec `needs` et les edits concurrents en worktrees se gardent pour plus tard, quand le modele mental, l'UI et les garanties d'annulation seront stabilises.

## Objectifs

- Permettre a plusieurs primitives read-only de tourner en parallele.
- Conserver un YAML comprehensible par un utilisateur qui ne pense pas en graphe.
- Garder l'approbation humaine comme point de controle avant toute modification du workspace.
- Rendre les outputs de chaque branche reutilisables dans les prompts suivants.
- Preparer une evolution future vers du DAG ou du map-reduce sans bloquer le design v2.

## Non-objectifs v2

- Pas de DAG libre avec `needs` arbitraires.
- Pas de boucle, condition, retry automatique ou timeout configurable.
- Pas d'edit concurrent dans le meme workspace.
- Pas de merge automatique de variantes d'implementation.
- Pas de primitive shell/test parallele tant que les primitives disponibles restent des agents ACP.

## Possibilites et compromis

| Option | Description | Avantages | Risques | Verdict |
|--------|-------------|-----------|---------|---------|
| A. Rester lineaire | Les pipelines restent `step -> step -> approval -> step`. | Simple, deja implemente, facile a debugger. | Ne permet pas la recherche multi-angle, plus lent pour les phases read-only. | Insuffisant pour la prochaine evolution. |
| B. Bloc `type: parallel` | Un step contient plusieurs branches lancees ensemble, puis un fan-in implicite. | Bon ratio valeur/complexite, facile a afficher, compatible avec le runner actuel. | Necessite une structure d'outputs par branche et une strategie d'erreur. | Choix conseille. |
| C. DAG libre avec `needs` | Chaque step declare ses dependances et le runner schedule tout ce qui est pret. | Tres flexible, proche des orchestrateurs de workflows. | Modele mental plus dur, UI plus complexe, reprise/annulation moins triviale. | A garder pour v3. |
| D. Map-reduce dynamique | Un step produit une liste, puis une primitive est appliquee a chaque item. | Puissant pour gros repos et analyses par fichier/module. | Exige des sorties structurees, limites de concurrence, UI pour N branches. | Apres le bloc parallel statique. |
| E. Edits paralleles en worktrees | Plusieurs agents implementent des variantes dans des worktrees separes, puis comparaison. | Tres puissant pour exploration de solutions. | Isolation, cout, merge, choix final et nettoyage plus complexes. | Plus tard, feature separee. |

## Choix conseille

Livrer une v2 centree sur un step :

```yaml
steps:
  - id: plan
    use: plan

  - id: investigate
    type: parallel
    branches:
      - id: repo
        use: repo_search
      - id: tests
        use: test_search
      - id: risks
        use: risk_review

  - id: synthesize
    use: synthesize

  - id: approve
    type: approval
    input: "{{steps.synthesize.output}}"

  - id: edit
    use: edit
```

Cette approche ajoute le parallelisme la ou il apporte le plus de valeur : avant l'approbation, sur des taches d'observation et de critique. Elle evite de lancer plusieurs agents qui modifient le workspace en meme temps.

## Cas d'usage prioritaires

### Recherche multi-angle avant approval

Apres un plan initial, lancer en parallele :

- `repo_search` pour inspecter le code concerne ;
- `test_search` pour trouver les tests et commandes de verification ;
- `risk_review` pour chercher les risques d'architecture, UX ou regression ;
- `docs_search` pour retrouver les conventions locales.

Un step `synthesize` regroupe ensuite les observations dans une version de plan plus robuste.

### Review parallele d'un plan

Un planner produit un plan, puis plusieurs reviewers specialisees le critiquent :

- architecture ;
- tests ;
- securite ;
- maintenabilite.

Le step suivant fusionne les retours et produit le plan soumis a l'utilisateur.

### Validation parallele apres implementation

Apres l'implementation, plusieurs primitives read-only peuvent tourner en parallele :

- review du diff ;
- verification des tests attendus ;
- controle documentation ;
- analyse des risques restants.

Cette variante doit rester prudente tant que les primitives de test/shell ne sont pas formalisees.

## Semantique YAML proposee

Un step parallele contient un `id`, `type: parallel` et une liste `branches`.

Chaque branche v2 ressemble a un step agent classique :

```yaml
- id: investigate
  type: parallel
  branches:
    - id: repo
      use: repo_search
    - id: tests
      use: test_search
```

Les branches partagent le meme contexte d'entree que le step parallele. Elles peuvent referencer les outputs des steps precedents, mais pas les outputs des branches voisines.

Les steps suivants referencent les outputs ainsi :

```yaml
{{steps.investigate.branches.repo.output}}
{{steps.investigate.branches.tests.output}}
```

Une syntaxe courte pourrait etre ajoutee plus tard :

```yaml
{{branches.investigate.repo.output}}
```

mais elle n'est pas necessaire pour la v2.

## Regles de validation

- `type: parallel` doit avoir au moins deux branches.
- Les ids de branches doivent etre uniques dans le step parallele.
- Une branche doit avoir `id` et `use`.
- `use` doit referencer une primitive existante.
- Les primitives utilisees dans un bloc parallele ne doivent pas declarer `sideEffects: workspace` en v2.
- Les templates d'une branche peuvent referencer `{{userPrompt}}` et les outputs des steps precedents.
- Les templates d'une branche ne peuvent pas referencer une autre branche du meme bloc.
- Les steps apres le bloc peuvent referencer les outputs de toutes les branches terminees.
- Si une branche attend un output `proposed_plan`, elle doit respecter la validation existante du bloc unique `<proposed_plan>`.

## Execution runner

Le runner garde un flux lineaire au niveau superieur :

1. executer les steps dans l'ordre ;
2. si le step est un agent, lancer une primitive ;
3. si le step est une approval, pauser ;
4. si le step est un parallel, lancer toutes les branches et attendre leur terminaison ;
5. stocker les resultats sous `stepOutputs[stepId].branches[branchId]` ;
6. reprendre le step suivant.

Le parallelisme reste donc local a un step. On evite un scheduler global de graphe.

## Erreurs, rejet et annulation

Pour v2, la strategie conseillee est fail-fast :

- si une branche echoue, le step parallele echoue ;
- les branches encore actives sont annulees ;
- le pipeline passe en statut failed ou cancelled selon la cause ;
- les outputs deja produits restent visibles pour debug, mais ne debloquent pas le step suivant.

Une strategie `continueOnError` peut etre ajoutee plus tard, mais elle complexifie tout de suite les prompts de synthese et la validation.

## UI conseillee

Dans la session pipeline :

- afficher le step parallele comme un groupe ;
- afficher chaque branche comme une sous-ligne avec son agent, son statut et son output ;
- garder l'ordre declare dans le YAML, meme si les branches terminent dans un ordre different ;
- au fan-in, afficher un resume du step parallele avant de passer au step suivant ;
- en cas d'erreur, montrer quelle branche a echoue.

Le point important est de ne pas transformer l'UI en visualiseur de graphe des la v2.

## Pourquoi pas le DAG libre maintenant

Le DAG libre est plus expressif, mais il force a resoudre plusieurs sujets en meme temps :

- detection de cycles ;
- scheduling global ;
- ordre non deterministe ;
- reprise apres approval placee au milieu du graphe ;
- annulation partielle ;
- rendu UI de dependances croisées ;
- templates qui referencent plusieurs chemins de dependances ;
- debug d'un graphe qui n'a plus d'ordre naturel de lecture.

Pour ACP Client, le besoin produit immediat est surtout de lancer plusieurs analyses read-only avant l'approval. Le bloc `parallel` couvre ce besoin sans imposer toute la complexite du DAG.

## Evolution possible

### v2 : parallel statique

```yaml
- id: investigate
  type: parallel
  branches:
    - id: repo
      use: repo_search
    - id: tests
      use: test_search
```

### v3 : map-reduce

```yaml
- id: files
  use: list_impacted_files

- id: inspect_files
  type: map
  foreach: "{{steps.files.output.items}}"
  as: file
  use: inspect_file

- id: synthesize
  use: synthesize
```

### v4 : DAG libre

```yaml
steps:
  - id: plan
    use: plan

  - id: repo_search
    use: repo_search
    needs: [plan]

  - id: test_search
    use: test_search
    needs: [plan]

  - id: synthesize
    use: synthesize
    needs: [repo_search, test_search]
```

### v5 : variantes d'implementation isolees

Chaque branche d'edit tourne dans son propre worktree. Le pipeline compare les diffs, demande une approbation humaine, puis applique la variante choisie.

## Plan d'implementation conseille

1. Etendre les types `PipelineStepDefinition` avec `PipelineParallelStepDefinition`.
2. Etendre le validateur YAML pour `type: parallel`.
3. Ajouter la resolution de templates pour les outputs de branches.
4. Ajouter le stockage des outputs de branches dans `PipelineRunState`.
5. Ajouter l'execution concurrente fail-fast dans `PipelineService`.
6. Ajouter les evenements de status par branche.
7. Adapter la webview pour afficher un groupe parallele.
8. Ajouter des tests unitaires de validation YAML.
9. Ajouter des tests runner pour succes, echec d'une branche, cancel et templates.

## Sources et inspirations

- Anthropic, "Building effective agents" : recommande de commencer simple et de combiner des patterns comme prompt chaining, parallelization, orchestrator-workers et evaluator-optimizer seulement quand cela apporte de la valeur.
  https://www.anthropic.com/engineering/building-effective-agents
- Google Agent Development Kit, "Parallel workflow" : montre un exemple de recherche web parallele suivie d'un agent de synthese.
  https://adk.dev/agents/workflow-agents/parallel-agents/
- Apache Airflow, "Dynamic Task Mapping" : illustre le pattern map/reduce et l'expansion dynamique de taches.
  https://airflow.apache.org/docs/apache-airflow/stable/authoring-and-scheduling/dynamic-task-mapping.html
- Dagster, "Dynamic graphs" : montre `map` et `collect` comme mecanisme de duplication runtime puis fan-in.
  https://docs.dagster.io/guides/build/ops/dynamic-graphs

## Decision recommandee

Adopter le bloc `type: parallel` statique comme prochaine feature. Le limiter aux primitives agents sans `sideEffects: workspace`, avec une strategie fail-fast et un fan-in explicite via les outputs de branches.

Cette decision garde le produit comprehensible, protege le workspace, et cree une base propre pour du map-reduce ou du DAG libre plus tard.
