# Équipes d'agents (Agent Teams)

Les **Équipes d'agents** offrent une manière déclarative de définir des workflows multi-rôles qui se compilent en [pipeline v2](./pipelines-langgraph.md) à l'exécution. Au lieu d'écrire manuellement un YAML pipeline complexe, vous définissez des rôles avec leurs agents et fichiers d'instructions, et ACP Client génère l'orchestration automatiquement.

## Vue d'ensemble

### Qu'est-ce qu'une Équipes d'agents ?

- **Workflows déclaratifs** : définissez ce que font les rôles, pas comment l'orchestration fonctionne
- **Basé sur les rôles** : chaque rôle (`planner`, `implementer`, `reviewer`, `tester`) utilise un agent ACP configuré
- **Compilé vers pipeline v2** : les équipes sont transformées en pipeline YAML standard en interne
- **Agents virtuels de première classe** : les équipes apparaissent dans l'arbre Agents aux côtés des agents réguliers et des pipelines

### Quand utiliser les Équipes d'agents ?

Utilisez les Équipes d'agents lorsque vous voulez :
- Une manière simple de créer des workflows "planifier-implémenter-relire"
- Des agents différents pour différentes phases (ex: Claude pour la planification, Vibe pour le codage, Code pour la revue)
- Des définitions de rôles réutilisables dans votre workspace
- Une configuration rapide sans apprendre tout le DSL pipeline

Utilisez le [YAML pipeline v2](./pipelines-langgraph.md) brut lorsque vous avez besoin :
- D'une orchestration de steps personnalisée au-delà de l'ordre fixe des rôles
- De branches parallèles
- D'une logique conditionnelle complexe
- De plusieurs planners ou implementers

## Guide rapide

1. Créez un fichier de définition d'équipe dans `.acp/teams/` :

```bash
mkdir -p .acp/teams
# Créez votre fichier d'équipe, par exemple feature-team.yaml
```

2. Définissez votre équipe (rôles requis minimum : planner, implementer, reviewer) :

```yaml
version: 1
id: feature-team
title: Feature Team
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

3. Créez des fichiers d'instructions pour chaque rôle (recommandé) :

```bash
mkdir -p .acp/agents
# Créez planner.md, implementer.md, reviewer.md avec des prompts spécifiques aux rôles
```

4. Assurez-vous que tous les agents référencés existent dans vos paramètres VS Code `acp.agents`
5. Rechargez VS Code si l'équipe n'apparaît pas immédiatement
6. Connectez-vous à l'agent virtuel "Feature Team" depuis la vue Agents
7. Envoyez votre demande — l'équipe va planifier, demander une approbation, implémenter et relire

## Emplacement des fichiers

Les définitions d'équipe sont chargées depuis :
```
.acp/teams/*.yaml
.acp/teams/*.yml
```

Les fichiers doivent avoir l'extension `.yaml` ou `.yml` et être du YAML valide.

## Spécification du format (v1)

### Schéma complet

```yaml
version: 1              # Requis : doit être 1
id: feature-team        # Requis : identifiant unique (alphanumérique + tirets/soulignés)
title: Feature Team     # Requis : nom affiché dans la vue Agents
orchestrator:           # Optionnel : métadonnée uniquement en v1
  agent: Codex CLI      # Champ de métadonnée ; NE S'EXÉCUTE PAS comme un LLM d'orchestration
roles:                  # Requis
  planner:             # Rôle requis
    agent: Codex CLI    # Requis : doit exister dans acp.agents
    instructions: .acp/agents/planner.md  # Requis : chemin vers les instructions Markdown
  implementer:          # Rôle requis
    agent: Vibe
    instructions: .acp/agents/implementer.md
  reviewer:            # Rôle requis
    agent: Claude Code
    instructions: .acp/agents/reviewer.md
  tester:               # Rôle optionnel
    agent: Codex CLI
    instructions: .acp/agents/tester.md
```

### Référence des champs

| Champ | Type | Requis | Description |
|-------|------|--------|-------------|
| `version` | number | Oui | Doit être `1` pour les équipes v1 |
| `id` | string | Oui | Identifiant unique, utilisé en interne. Alphanumérique, tirets, soulignés recommandés. |
| `title` | string | Oui | Nom affiché dans l'arbre Agents |
| `orchestrator.agent` | string | Non | Champ de métadonnée en v1. Documente l'intention mais NE S'EXÉCUTE PAS comme un LLM actif. |
| `roles` | object | Oui | Conteneur pour les définitions de rôles |
| `roles.planner` | object | Oui | Rôle de planification. Génère une sortie `proposed_plan`. |
| `roles.implementer` | object | Oui | Rôle d'implémentation. Peut modifier le workspace. |
| `roles.reviewer` | object | Oui | Rôle de revue. Analyse la sortie de l'implémentation. |
| `roles.tester` | object | Non | Rôle de test optionnel. S'exécute après le reviewer. |
| `roles.<rôle>.agent` | string | Oui | Nom d'un agent ACP configuré dans `acp.agents` |
| `roles.<rôle>.instructions` | string | Oui | Chemin vers le fichier Markdown avec les instructions spécifiques au rôle |

### Champs interdits dans les définitions de rôles

NE pas inclure ces champs dans les définitions de rôles — ils sont générés par le compilateur :
- `sideEffects`
- `output`
- `prompt`

Cela provoquera des erreurs de validation.

## Règles de validation

### Rôles requis
- `planner` — requis
- `implementer` — requis
- `reviewer` — requis
- `tester` — optionnel (peut être omis)

### Références d'agents
- Chaque agent nommé dans `roles.<rôle>.agent` DOIT exister dans les paramètres `acp.agents`
- Le champ `orchestrator.agent` (s'il est présent) doit également référencer un agent existant

### Fichiers d'instructions
- Les chemins des fichiers d'instructions sont résolus par rapport à la racine du workspace
- Les chemins doivent être dans le workspace (ne peuvent pas référencer des chemins en dehors du projet)
- Les fichiers doivent être lisibles et du Markdown UTF-8 valide
- Taille maximale des fichiers d'instructions : `acp.instructions.maxBytes` (par défaut : 262144 octets ≈ 256Ko)
- Si un fichier d'instructions ne peut pas être lu, la validation de l'équipe échoue

### Contraintes d'ID et de titre
- L'`id` de l'équipe doit être unique parmi toutes les équipes et pipelines
- Le `title` de l'équipe apparaît comme le nom de l'agent virtuel dans la vue Agents
- Les titres ne doivent pas entrer en conflit avec les titres existants de `.acp/pipelines/*.yaml`

## Fichiers d'instructions

### Objectif

Les fichiers d'instructions contiennent les prompts spécifiques aux rôles qui guident le comportement de chaque agent. Séparer les instructions du YAML d'équipe permet :

- De réutiliser les mêmes instructions dans plusieurs équipes
- De versionner les prompts avec votre code
- De garder les définitions d'équipe concises

### Exemple : planner.md

```markdown
# Instructions du Planificateur

Vous êtes l'expert en planification pour cette base de code. Votre travail consiste à créer des plans d'implémentation complets et prêts pour la décision.

## Directives

1. Analyser attentivement la demande de l'utilisateur
2. La diviser en étapes discrètes et ordonnées
3. Identifier les dépendances et les risques
4. Retourner EXACTEMENT UN bloc `<proposed_plan>`

## Format

```
<proposed_plan>
1. [Description de l'étape 1]
2. [Description de l'étape 2]
...
</proposed_plan>
```

## Contexte

- Répertoire courant : {{userPrompt}}
- Workspace : [racine du workspace]
```

### Variables de template

Lorsque ACP Client compile l'équipe en un pipeline, le contenu des fichiers d'instructions est intégré dans les prompts générés avec un contexte supplémentaire. Le compilateur ajoute :

- **Pour le planner** : la demande utilisateur est ajoutée après les instructions
- **Pour l'implementer** : la demande utilisateur et le plan approuvé sont ajoutés
- **Pour le reviewer** : la demande utilisateur, le plan approuvé et la sortie de l'implémentation sont ajoutés
- **Pour le tester** : la demande utilisateur, le plan approuvé, la sortie de l'implémentation et la sortie de la revue sont ajoutés

## Modèle d'exécution

### Ordre des rôles

Les équipes exécutent les rôles dans cet ordre fixe :

```
planner → approval → implementer → reviewer → tester (optionnel)
```

### Étapes de pipeline générées

Chaque équipe se compile en un pipeline v2 avec ces étapes :

1. **plan** : Exécute le rôle planner, attend une sortie `proposed_plan`
2. **approval** : Passerelle de revue humaine — vous devez approuver le plan pour continuer
3. **implement** : Exécute le rôle implementer avec `sideEffects: workspace`
4. **review** : Exécute le rôle reviewer pour analyser l'implémentation
5. **test** (si le rôle tester existe) : Exécute le rôle tester pour une validation supplémentaire

### Effets secondaires et Sandcastle

- **Seul `implementer` peut modifier le workspace** (`sideEffects: workspace`)
- Pour des modifications isolées, assignez un agent **Sandcastle** au rôle implementer — la passerelle de promotion (Voir le Diff / Appliquer / Rejeter) s'ouvre automatiquement après l'étape
- Les agents natifs écrivent directement dans le workspace
- Tous les autres rôles (`planner`, `reviewer`, `tester`) sont en lecture seule (`sideEffects: none`)

### Deux gates : approbation du plan vs promotion Sandcastle

Les équipes et pipelines utilisent **deux gates indépendantes**. Ne les confondez pas :

```
planner → [GATE 1 : humain — plan] → implementer (sandbox) → [GATE 2 : Sandcastle — patch] → reviewer
```

Le verdict de promotion contrôle la suite : **Apply** et **aucun changement** continuent vers reviewer/tester ; **Reject** termine le run comme rejeté ; fermer la palette l'annule et nettoie le sandbox éphémère ; un échec d'Apply termine le run en erreur. Aucun snapshot d'équipe terminé n'est enregistré pour ces runs interrompus.

| Gate | Quand | Qui décide | Réglage |
|------|-------|------------|---------|
| **Approbation du plan** | Après planner, avant implementer | Humain (Approuver/Rejeter + édition du `<proposed_plan>`) | Toujours obligatoire — indépendante de Sandcastle |
| **Promotion Sandcastle** | Après un run implementer avec effets workspace | Humain ou auto selon config | `acp.sandcastle.promotion` (`ask` / `autoApply` / `autoReject`) |

La gate 1 est une **interrupt LangGraph** (`type: approval`). Elle n'est jamais contournée parce que l'implementer est Sandcastle, parce que `acp.sandcastle.promotion` vaut `autoApply`, ou parce que Sandcastle auto-approuve les permissions outils dans le sandbox.

Avec `acp.sandcastle.promotion: autoApply`, seule la **promotion du patch** est automatique après l'implementer. Vous devez toujours approuver le plan dans le chat avant le début de l'implémentation.

**Test manuel (Feature Team avec implementer Sandcastle) :**

1. Connecter **Feature Team** (pas un agent Sandcastle seul)
2. Envoyer une demande
3. Vérifier le bloc plan et les boutons **Approuver le plan** / **Rejeter le plan** ; la timeline affiche **Approbation du plan (humain)**
4. Approuver → l'implementer tourne dans Sandcastle
5. Ensuite seulement : QuickPick Apply/Reject (si `promotion: ask`) ou apply auto (si `autoApply`)

### Flux d'approbation

1. Le planner génère un plan proposé
2. Le plan est affiché dans le chat avec l'interface d'approbation
3. Vous pouvez modifier le texte du plan avant de l'approuver
4. Une fois approuvé, le plan est transmis à l'implementer
5. En cas de rejet, l'exécution de l'équipe s'arrête

## Interface utilisateur

### Vue Agents

- Les équipes apparaissent comme des agents virtuels avec une icône d'organisation (🏢)
- Le nom affiché correspond au champ `title` de l'équipe
- Les équipes invalides apparaissent comme `Titre (invalide)` avec l'erreur de validation dans l'infobulle

### Affichage du chat

- Affiche une timeline des rôles indiquant l'étape actuelle
- La sortie de chaque rôle apparaît dans des sections isolées
- Les étapes d'approbation affichent le plan dans un bloc `<proposed_plan>` avec des boutons approuver/rejeter
- Les exécutions d'équipe maintiennent une seule session ; les exécutions internes des rôles sont des détails d'implémentation

### Exemple de flux de chat

```
Utilisateur : Ajouter un nouveau point de terminaison d'API pour les profils utilisateurs

Feature Team (planification en cours...)
├── planner: Codex CLI
│   ✓ Plan généré
│
Feature Team
└── Approbation du plan (humain)
    
    <proposed_plan>
    1. Créer le modèle de profil utilisateur dans src/models/UserProfile.ts
    2. Ajouter la route API dans src/routes/userProfile.ts
    3. Ajouter les tests dans tests/userProfile.test.ts
    </proposed_plan>
    
    [Modifier le Plan] [Approuver le plan] [Rejeter le plan]

L'utilisateur clique sur Approuver

Feature Team (implémentation en cours...)
├── planner: Codex CLI ✓
├── approval: Approuvé ✓
└── implementer: Vibe
    Exécution dans le sandbox...

Feature Team (revue en cours...)
├── planner: Codex CLI ✓
├── approval: Approuvé ✓
├── implementer: Vibe ✓
└── reviewer: Claude Code
    Analyse des modifications...

Feature Team
Toutes les étapes terminées. Modifications prêtes pour la promotion.
[Voir le Diff] [Appliquer] [Rejeter]
```

## Commandes

| Commande | Description |
|----------|-------------|
| `ACP: Show Compiled Team Pipeline` | Inspecter le JSON pipeline v2 généré pour une équipe. Utile pour le débogage et la compréhension de la compilation de votre équipe. |
| `ACP: Re-run Team Reviewer` | Exécuter uniquement le rôle reviewer sur la dernière exécution d'équipe terminée et le diff git actuel. Permet de relire sans réexécuter toute l'équipe. |

## Paramètres

| Paramètre | Valeur par défaut | Description |
|-----------|------------------|-------------|
| `acp.pipeline.enabled` | `true` | Doit être activé pour que les équipes apparaissent comme des agents virtuels |
| `acp.instructions.maxBytes` | `262144` | Taille maximale en octets pour les fichiers d'instructions Markdown |

Pour isoler l'implementer, assignez un agent Sandcastle dans le YAML de l'équipe.

## Exemple complet

### Structure des répertoires

```
mon-projet/
├── .acp/
│   ├── teams/
│   │   └── feature-team.yaml
│   └── agents/
│       ├── planner.md
│       ├── implementer.md
│       └── reviewer.md
└── src/
    └── ...
```

### .acp/teams/feature-team.yaml

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
  reviewer:
    agent: Claude Code
    instructions: .acp/agents/reviewer.md
```

### .acp/agents/planner.md

```markdown
# Planificateur de Fonctionnalités

Créez des plans d'implémentation concis et actionnables.

Règles :
- Retourner EXACTEMENT UN bloc `<proposed_plan>`
- Chaque étape doit être spécifique et testable
- Identifier les chemins de fichiers précisément
- Noter les dépendances ou prérequis

La demande utilisateur sera fournie après ces instructions.
```

### .acp/agents/implementer.md

```markdown
# Implémenteur de Fonctionnalités

Implémentez le plan approuvé précisément.

Directives :
- Suivez le plan exactement
- Écrivez du code propre et idiomatique
- Incluez des tests appropriés
- Les messages de commit doivent référencer la fonctionnalité

Le plan approuvé sera fourni après la demande utilisateur.
```

### .acp/agents/reviewer.md

```markdown
# Relecteur de Fonctionnalités

Relisez l'implémentation par rapport au plan approuvé.

Liste de vérification :
- Le code correspond-il au plan ?
- Y a-t-il des problèmes ou des bugs ?
- Le code est-il bien structuré ?
- Les tests sont-ils adéquats ?

Fournissez un retour clair sur les écarts.
```

## Limites (v1)

### Contraintes de rôles
- Seulement 4 rôles supportés : `planner`, `implementer`, `reviewer`, `tester`
- `tester` est optionnel ; les 3 autres sont requis
- Pas de noms de rôles personnalisés en v1
- L'ordre des rôles est fixe : planner → approval → implementer → reviewer → tester

### Contraintes d'orchestration
- Pas d'ordre de steps personnalisé — les rôles s'exécutent toujours dans l'ordre fixe
- Pas d'exécution parallèle de rôles — chaque rôle s'exécute séquentiellement
- Pas de branches conditionnelles — tous les rôles s'exécutent en séquence (sauf tester, qui est optionnel)
- Le champ `orchestrator.agent` est une métadonnée uniquement — il NE S'EXÉCUTE PAS comme un LLM actif

### Contraintes de pipeline
- Les équipes se compilent en pipeline v2, pas dans un moteur d'orchestration séparé
- Toutes les règles pipeline v2 s'appliquent : les effets workspace nécessitent une approbation préalable
- Les équipes ne peuvent pas référencer d'autres équipes (pas d'imbrication)
- La taille maximale des instructions s'applique à tous les fichiers d'instructions de rôles

### Contraintes de nommage
- Les IDs d'équipe ne doivent pas entrer en conflit avec les IDs de `.acp/pipelines/*.yaml`
- Les titres d'équipe doivent être uniques dans la vue Agents

## Erreurs courantes

| Erreur | Cause | Correction |
|--------|-------|------------|
| `Titre de l'équipe (invalide)` dans la vue Agents | Échec de la validation YAML | Vérifiez l'infobulle pour l'erreur spécifique, corrigez le YAML |
| L'équipe n'apparaît pas | `acp.pipeline.enabled` est false, ou le fichier n'est pas dans `.acp/teams/` | Activez le paramètre, déplacez le fichier au bon endroit |
| `roles.<rôle> is required` | Rôle requis manquant | Ajoutez le rôle manquant à votre définition d'équipe |
| `roles.<rôle>.agent references missing ACP agent` | Agent non configuré | Ajoutez l'agent à `acp.agents` dans les paramètres |
| `roles.<rôle>.instructions could not be resolved` | Fichier d'instructions introuvable | Créez le fichier ou corrigez le chemin |
| `version must be 1` | Numéro de version incorrect | Définissez `version: 1` |
| `roles.<rôle> is not an allowed role` | Nom de rôle invalide | Utilisez uniquement : planner, implementer, reviewer, tester |
| `roles.<rôle>.sideEffects is not allowed` | Champ interdit dans le YAML d'équipe | Supprimez `sideEffects` — il est généré par le compilateur |

## Relation avec le pipeline v2

Les Équipes d'agents sont une couche de commodité par-dessus le pipeline v2 :

- **YAML d'équipe** → `AgentTeamCompiler` → **JSON pipeline v2**
- Le pipeline généré a des primitives et des steps correspondant aux rôles de l'équipe
- Toutes les fonctionnalités pipeline v2 sont disponibles, mais les équipes exposent une interface plus simple
- Vous pouvez inspecter le pipeline généré avec `ACP: Show Compiled Team Pipeline`

Pour les cas d'utilisation avancés, écrivez le YAML pipeline v2 directement. Pour les workflows standard planifier-implémenter-relire, les équipes offrent une expérience d'auteur plus simple.

## Migration depuis les pipelines bruts

Si vous avez un pipeline v2 YAML existant comme :

```yaml
version: 2
id: my-flow
title: My Flow
primitives:
  planner:
    agent: Codex CLI
    output: proposed_plan
    sideEffects: none
    prompt: ...
  implementer:
    agent: Vibe
    output: markdown
    sideEffects: workspace
    prompt: ...
  reviewer:
    agent: Claude Code
    output: markdown
    sideEffects: none
    prompt: ...
steps:
  - id: plan
    use: planner
  - id: approval
    type: approval
    input: "{{steps.plan.output}}"
  - id: implement
    use: implementer
  - id: review
    use: reviewer
```

Vous pouvez simplifier en une équipe :

```yaml
version: 1
id: my-flow
title: My Flow
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

Le compilateur d'équipe génère automatiquement le pipeline équivalent.

## Voir aussi

- [DSL Pipeline v2](./pipelines-langgraph.md) — La couche d'orchestration sous-jacente
- [ADR-0012 : Architecture des Équipes d'agents](../adr/0012-equipes-agents.md) — Décisions de conception et justification
- [Architecture Sandcastle](../docs/sandcastle-architecture.md) — Isolation Docker et workflow de promotion
