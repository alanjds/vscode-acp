# ADR-0012 : Équipes d'agents - Workflows déclaratifs basés sur les rôles

**Statut** : Accepté

## Contexte

Les utilisateurs veulent une manière simple de créer des workflows multi-agents suivant le pattern courant "planifier-implémenter-relire" sans écrire de YAML pipeline v2 complexe. Le DSL pipeline v2 existant offre un contrôle total mais nécessite la compréhension des primitives, steps, passerelles d'approbation et variables de template. Cela crée une barrière pour les utilisateurs qui veulent des workflows standards avec des agents différents pour chaque rôle.

L'inspiration d'outils comme Polly d'Omnigent a montré que les utilisateurs répondent bien aux abstractions basées sur les rôles (planner, implementer, reviewer) qui masquent la complexité de l'orchestration. L'extension ACP Client avait déjà un moteur pipeline v2 fonctionnel avec orchestration LangGraph, passerelles d'approbation et support sandbox.

Besoins utilisateurs clés identifiés :
- Configuration rapide pour les workflows standards planifier-implémenter-relire
- Des agents différents pour différentes phases (par exemple, un modèle pour la planification, un autre pour le codage)
- Des définitions de rôles réutilisables dans un workspace
- Séparation claire entre la planification et les étapes modifiant le workspace
- Intégration avec l'infrastructure sandbox et d'approbation existante

## Décision

1. **Ajouter les Équipes d'agents comme une couche déclarative** par-dessus pipeline v2, et non comme un moteur d'orchestration séparé.
   - Les équipes définissent des rôles (`planner`, `implementer`, `reviewer`, `tester`) avec des affectations d'agents et des fichiers d'instructions
   - Les équipes se compilent en JSON pipeline v2 à l'exécution via `AgentTeamCompiler`
   - Toutes les fonctionnalités pipeline v2 (approbation, sandbox, validation) sont héritées automatiquement

2. **Jeu de rôles fixe en v1** :
   - Rôles requis : `planner`, `implementer`, `reviewer`
   - Rôle optionnel : `tester`
   - Ordre d'exécution fixe : planner → approval → implementer → reviewer → tester

3. **Format de fichier et emplacement** :
   - Définitions d'équipe dans `.acp/teams/*.yaml` (ou `.yml`)
   - Schéma YAML avec `version: 1`, `id`, `title`, `roles`
   - Fichiers d'instructions externes référencés par chemin (résolus par rapport à la racine du workspace)
   - Champ `orchestrator.agent` comme métadonnée uniquement (ne s'exécute pas comme un LLM)

4. **Comportement de compilation** :
   - Chaque rôle se compile en une primitive pipeline v2 avec des prompts générés
   - Planner : `output: proposed_plan`, `sideEffects: none`
   - Implementer : `output: markdown`, `sideEffects: workspace`
   - Reviewer : `output: markdown`, `sideEffects: none`
   - Tester : `output: markdown`, `sideEffects: none`
   - Étape d'approbation automatiquement insérée entre planner et implementer

5. **Intégration avec l'infrastructure existante** :
   - Les équipes chargées par `AgentTeamCatalog` aux côtés des fichiers pipeline
   - Les équipes apparaissent comme des agents virtuels dans l'arbre Agents via `PipelineService`
   - Passerelle de promotion Sandcastle affichée automatiquement quand l'implementer utilise un agent Sandcastle
   - Taille des fichiers d'instructions limitée par le paramètre `acp.instructions.maxBytes`

6. **Règles de validation** :
   - Tous les agents référencés doivent exister dans `acp.agents`
   - Tous les chemins de fichiers d'instructions doivent être résolvables et dans le workspace
   - Champs interdits (`sideEffects`, `output`, `prompt`) rejetés dans le YAML d'équipe
   - Les IDs d'équipe ne doivent pas entrer en conflit avec les IDs de pipeline

7. **Commandes dédiées** :
   - `ACP: Show Compiled Team Pipeline` — inspecter le JSON pipeline v2 généré
   - `ACP: Re-run Team Reviewer` — réexécuter le reviewer sur la dernière exécution d'équipe + diff git actuel

## Conséquences

### Positives

- **Barrière d'entrée plus basse** : les utilisateurs peuvent créer des workflows multi-agents avec un YAML minimal
- **Cohérence** : les équipes héritent de toutes les fonctionnalités de sécurité pipeline v2 (passerelles d'approbation, sandbox, validation)
- **Réutilisabilité** : les fichiers d'instructions peuvent être partagés entre équipes et pipelines
- **Maintenabilité** : un seul moteur d'orchestration (pipeline v2) à maintenir
- **Chemin de montée en puissance** : les équipes peuvent être "dépliées" en pipeline v2 brut si personnalisation nécessaire
- **Pas de changements cassants** : les pipelines existants non affectés ; les équipes sont additives

### Négatives

- **Flexibilité limitée en v1** : ordre des rôles fixe, pas de rôles parallèles, pas de rôles personnalisés
- **Confusion de métadonnées** : le champ `orchestrator.agent` pourrait suggérer une orchestration active (ce n'est pas le cas)
- **Découverte** : les équipes comme concept séparé pourraient confondre les utilisateurs familiers avec les pipelines uniquement
- **Terminologie** : "Agent Teams" vs "Équipes d'agents" nécessite de maintenir une double terminologie

### Neutres

- **Overhead de compilation** : les équipes ajoutent une étape de compilation, mais les performances à l'exécution sont identiques à pipeline v2
- **Fuite d'abstraction** : les utilisateurs pourraient avoir besoin de comprendre pipeline v2 pour le débogage (d'où la commande `Show Compiled Team Pipeline`)

## Alternatives envisagées

### Alternative 1 : Nouveau moteur d'orchestration

**Proposition** : Créer un moteur d'orchestration séparé spécifiquement pour les équipes d'agents avec sa propre machine à états.

**Rejetée car** :
- Duplique la fonctionnalité pipeline v2 existante
- Crée deux systèmes d'orchestration à maintenir
- Perd l'intégration avec l'infrastructure d'approbation et de sandbox existante
- Nécessiterait de réimplémenter toutes les vérifications de sécurité et la validation

**Conservé de cette approche** : Le concept basé sur les rôles et l'abstraction orientée utilisateur.

### Alternative 2 : Étendre le DSL pipeline v2

**Proposition** : Ajouter une syntaxe de type équipe directement dans le DSL pipeline v2 (par exemple, une section `roles:` aux côtés de `primitives:`).

**Rejetée car** :
- Complexifie le schéma pipeline v2
- Mélange deux niveaux d'abstraction dans un seul fichier
- Perd la simplicité d'avoir des définitions d'équipe séparées et ciblées
- Nécessiterait toujours une étape de compilation en interne

**Conservé de cette approche** : L'idée de fichiers d'instructions externes.

### Alternative 3 : Profils d'agents d'abord

**Proposition** : D'abord implémenter les profils d'agents (`.acp/agents/*.yaml`), puis construire les équipes par-dessus les profils.

**Partiellement adoptée** :
- Les équipes référencent bien les agents par nom depuis les paramètres `acp.agents`
- Les fichiers d'instructions servent un objectif similaire aux profils d'agents pour les prompts
- Cependant, les profils d'agents complets (avec modèle, mode, permissions) restent une fonctionnalité séparée
- Les équipes v1 se concentrent spécifiquement sur le pattern d'orchestration de rôles

### Alternative 4 : Format JSON

**Proposition** : Utiliser JSON au lieu de YAML pour les définitions d'équipe.

**Rejetée car** :
- YAML est plus lisible pour les fichiers de configuration
- Pattern déjà établi dans la base de code (pipeline v2 utilise YAML)
- YAML supporte les commentaires (utile pour la documentation)
- L'infrastructure de chargement YAML existante peut être réutilisée

### Alternative 5 : Orchestrateur implicite

**Proposition** : Rendre l'orchestrateur un LLM actif qui coordonne dynamiquement entre les rôles.

**Rejetée pour v1 car** :
- Ajoute une complexité significative
- Nécessite de définir des prompts et capacités d'orchestrateur
- Plus difficile à comprendre et à déboguer
- L'approche actuelle (compilation statique) est plus simple et plus prévisible
- Peut être ajoutée dans une version future sans casser les équipes existantes

**Conservé pour l'avenir** : Le champ `orchestrator.agent` est réservé pour une utilisation potentielle future.

## Considérations futures

- **Rôles personnalisés** : Permettre aux utilisateurs de définir des types de rôles supplémentaires au-delà du jeu v1
- **Rôles parallèles** : Supporter l'exécution parallèle de plusieurs implementers ou testers (nécessite de relâcher les restrictions parallèles de pipeline v2)
- **Orchestrateur actif** : Rendre `orchestrator.agent` un LLM réel qui coordonne et peut ajuster dynamiquement le workflow
- **Composition d'équipes** : Permettre aux équipes de référencer d'autres équipes (imbrication)
- **Conditions de rôle** : Ajouter l'exécution conditionnelle des rôles basée sur les sorties précédentes
- **Intégration des profils** : Intégration complète avec un futur système de profils d'agents

## ADRs liés

- [ADR-0005 : Pipeline A2A ACP](../adr/0005-a2a-acp-pipeline.md) — Conception originale du pipeline v2
- [ADR-0013 : Bridge ACP Sandcastle](../docs/adr/0013-acp-sandcastle-bridge.md) — Isolation Docker utilisée par les équipes pour les étapes workspace
