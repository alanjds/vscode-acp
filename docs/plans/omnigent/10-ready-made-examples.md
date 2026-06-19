# Plan Feature 10 - Exemples prêts à l'emploi

## Inspiration Omnigent

Références :

- README, exemples Polly et Debby : https://github.com/omnigent-ai/omnigent#polly-and-debby
- Dossier examples : https://github.com/omnigent-ai/omnigent/tree/main/examples
- Spec Agent YAML : https://github.com/omnigent-ai/omnigent/blob/main/docs/AGENT_YAML_SPEC.md

Omnigent fournit des exemples qui démontrent les patterns clés : orchestrateur de code, comparaison entre modèles, débat/synthèse. ACP Client devrait fournir des exemples locaux pour rendre les pipelines et profils agents immédiatement compréhensibles.

## Parallèle avec l'existant dans ACP Client

ACP Client a déjà la documentation et le loader nécessaires, mais peu d'exemples prêts à copier :

- `.acp/pipelines/*.yaml` est le format workspace chargé par `PipelineCatalog` ;
- `docs/pipeline-a2a.md` donne la spec, mais pas une galerie d'usages ;
- `src/test/PipelineCatalog.test.ts` valide déjà des YAML de pipeline ;
- `README.md` décrit les commandes, mais pas des scénarios bout en bout.

Omnigent utilise ses exemples comme démonstrateurs produit. ACP Client devrait faire pareil avec des workflows locaux adaptés à VS Code, en gardant les noms d'agents existants du plugin.

Le parallèle direct est donc :

- Omnigent `examples/polly` -> exemple ACP `plan-execute-review` ;
- Omnigent `examples/debby` -> exemple ACP `compare-agents` ;
- Omnigent tutorial YAML -> docs/examples avec commande de copie ;
- Omnigent demo agents -> pipelines testables via `PipelineCatalog.test.ts`.

## Objectif ACP Client

Créer une bibliothèque d'exemples sous `docs/examples` ou `.acp/examples` avec instructions, profils et pipelines copiables.

## Exemples cibles

### `plan-execute-review`

Workflow :

1. Plan par Codex.
2. Approbation humaine.
3. Implémentation par Vibe dans sandbox.
4. Review par Claude Code.
5. Promotion manuelle du diff.

### `compare-agents`

Workflow :

1. Prompt envoyé à deux agents en parallèle.
2. Affichage côte à côte.
3. Synthèse optionnelle.

### `test-writer`

Workflow :

1. Analyse du code ciblé.
2. Génération de tests.
3. Exécution test command.
4. Résumé des échecs.

### `doc-writer`

Workflow :

1. Lecture des fichiers mentionnés.
2. Proposition de doc.
3. Mise à jour après approbation.

## Intégration dans le code local

Points d'entrée existants :

- `.acp/pipelines/*.yaml` pour les pipelines workspace.
- `docs/pipeline-a2a.md` pour documenter le DSL.
- `README.md` pour les workflows utilisateur.
- `src/config/PipelineCatalog.ts` pour le chargement.

Changements proposés :

- Ajouter `docs/examples/pipelines/*.yaml`.
- Ajouter `docs/examples/agents/*.yaml` quand les profils agents existent.
- Ajouter une commande "Create Example Pipeline" pour copier un exemple dans `.acp/pipelines`.
- Ajouter des tests de parsing pour chaque exemple.

## UX

- Quick Pick d'exemples avec description courte.
- Prévisualisation du YAML avant copie.
- Message indiquant quels agents doivent être configurés.

## Risques

- Exemples cassés si les noms d'agents préconfigurés changent.
- Exemples trop ambitieux pour un premier usage.
- Confusion si un exemple nécessite un agent non installé.

## Découpage

1. Ajouter exemples documentaires.
2. Ajouter tests de validation YAML.
3. Ajouter commande de copie.
4. Relier README et roadmap.
