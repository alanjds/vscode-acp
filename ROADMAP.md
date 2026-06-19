# Roadmap ACP Client

Cette roadmap regroupe les idées d'évolution et les possibilités pour ACP Client, une extension VS Code permettant de connecter l'éditeur à des agents compatibles avec l'Agent Client Protocol.

## Objectifs du Projet

- Offrir une interface VS Code fiable pour discuter avec des agents ACP depuis le workspace courant.
- Faciliter le passage d'un agent à un autre tout en conservant les sessions, l'historique et les options propres à chaque agent.
- Rendre les workflows agentiques plus sûrs grâce à une gestion claire des permissions, du contexte envoyé et des actions terminal/fichier.
- Explorer des scénarios multi-agents, notamment la séparation entre planification et implémentation.

## Priorités Court Terme

- Refaire le sandbox : repenser l'architecture git worktree, les handlers terminal/fichier, le flux Apply/Reject et les garde-fous applicatifs (policies, allowlist réseau, limites explicites dans l'UI) pour une isolation workspace plus fiable.
- Stabiliser la liste des sessions et les mécanismes de reprise selon les capacités réellement exposées par chaque agent.
- Améliorer le contexte VS Code envoyé aux agents avec des contrôles plus visibles et une meilleure prévisibilité pour l'utilisateur.
- Finaliser l'expérience des mentions de fichiers dans le composer afin de remplacer complètement l'ancien flux d'attachement.
- Renforcer les messages d'erreur autour du lancement des agents, de l'authentification et des commandes introuvables.
- Documenter plus clairement les agents préconfigurés, leurs prérequis et leurs limites.

## Possibilités Moyen Terme

- Permettre d'ouvrir la fenêtre de chat dans un onglet de la zone éditeur, en complément de la vue latérale actuelle. Une commande doit pouvoir ouvrir ou déplacer le chat sans perdre la session, l'historique, le brouillon ni le run en cours. L'implémentation devra utiliser les API VS Code stables (`WebviewPanel` et restauration via serializer), partager le même état avec la `WebviewView` existante et être testée sous VS Code et Cursor lorsque leurs API sont compatibles.
- Ajouter des profils d'agents pour sauvegarder des combinaisons de modèle, mode, niveau de raisonnement, permissions et répertoire de travail.
- Proposer une recherche dans l'historique des sessions, avec filtres par agent, date, titre et contenu.
- Permettre l'export et l'import de sessions pour faciliter le partage ou l'archivage.
- Améliorer le pipeline planification puis implémentation avec un suivi plus détaillé des étapes, des statuts et des erreurs.
- Ajouter des modèles de prompts réutilisables pour les tâches fréquentes : revue de code, génération de tests, refactorisation, documentation.
- Enrichir le registre d'agents avec des métadonnées utiles : installation, authentification, compatibilité ACP, plateformes supportées.

## Idées Long Terme

- Expérimenter des workflows multi-agents où plusieurs agents peuvent comparer, critiquer ou compléter leurs réponses.
- Ajouter un mode de comparaison pour envoyer le même prompt à plusieurs agents et afficher les résultats côte à côte.
- Introduire des automatisations pilotées par session, par exemple relancer une vérification, générer un résumé ou préparer une suite de tâches.
- Mieux intégrer les plans proposés dans l'interface, avec approbation, rejet, édition et historique des décisions.
- Étendre la compatibilité vers d'autres protocoles ou passerelles lorsque cela améliore l'interopérabilité avec l'écosystème agentique.

## Pistes Techniques et UX

- Augmenter la couverture de tests sur les flux critiques : sessions, reprise, permissions, contexte éditeur, webview et pipeline.
- Isoler davantage les composants de la webview pour simplifier les évolutions du chat, du composer et des blocs de résultat.
- Améliorer la persistance locale afin de mieux gérer les workspaces multiples, les sessions supprimées et les agents non disponibles.
- Durcir la politique de sécurité autour des accès fichiers, des commandes terminal et des approvals automatiques.
- Ajouter une télémétrie optionnelle centrée sur la fiabilité : erreurs de connexion, échecs de reprise, latence de session et causes d'annulation.
- Clarifier les états UI lorsque l'agent ne supporte pas certaines capacités ACP, au lieu de masquer implicitement les actions.

## Nouvelles Idées à Explorer

- Visualiser les familles de contexte entre sessions sous forme de graphe ou de filiation.
- Prévisualiser et éditer le contexte qui sera injecté avant l'envoi au nouvel agent.
- Ajouter des profils de pipeline configurables avec rôles planner, reviewer, implementer et tester.
- Conserver un historique des plans proposés, approuvés, rejetés ou modifiés.
- Comparer le plan approuvé avec les changements réellement produits par l'agent d'implémentation.
- Ajouter un centre de diagnostic capable de générer un bundle de support filtré à partir des snapshots de debug.
- Ajouter des indicateurs de budget de contexte/tokens pour éviter les prompts trop volumineux.
- Proposer des politiques de permissions par workspace ou par profil d'agent.
- Améliorer le registre d'agents avec des contrôles de disponibilité, installation et authentification.

## Fonctionnalités Inspirées d'Omnigent

Cette section détaille les fonctionnalités observées dans Omnigent qui peuvent être adaptées à ACP Client. Le périmètre volontairement retenu reste local et centré VS Code : les fonctions cloud, serveur déployé, comptes multi-utilisateurs, invitation de teammates, co-drive distant et partage d'agents entre utilisateurs sont hors scope pour cette roadmap.

### 1. Agents déclaratifs en YAML

Omnigent permet de définir un agent dans un fichier YAML unique : nom, prompt ou fichier d'instructions, runtime, modèle, outils, sous-agents, accès OS, terminaux et politiques. ACP Client devrait proposer un équivalent local via `.acp/agents/*.yaml`.

Objectif :

- Créer des agents réutilisables versionnés avec le workspace.
- Eviter de tout configurer dans les settings VS Code globaux.
- Permettre à un projet de fournir ses propres agents spécialisés.
- Faire apparaître ces agents dans la vue Agents comme des agents virtuels locaux.

Exemple cible :

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

Travail à prévoir :

- Ajouter un `AgentProfileCatalog` qui charge `.acp/agents/*.yaml`.
- Valider le schéma YAML et remonter les erreurs dans le log ACP.
- Fusionner profil local, configuration agent existante et options de session ACP.
- Ajouter un watcher sur `.acp/agents/*.yaml`.
- Documenter le format dans `docs/agent-profiles.md`.

Remarque v1 :

- Si ces profils exigent une forte customisation du comportement agent, par exemple modifier le prompt système natif plutôt que seulement injecter un fichier `instructions`, la v1 sera cadrée autour de `pi Agent`. Le CLI `pi` expose déjà `--system-prompt` et `--append-system-prompt`, ce qui permet de tester proprement les profils spécialisés sans imposer immédiatement un adaptateur profond à tous les agents ACP.

### 2. Instructions partagées par agent

Omnigent permet de référencer un fichier d'instructions plutôt que d'intégrer tout le prompt dans le YAML. ACP Client devrait supporter `instructions: path/to/file.md` pour partager des consignes longues entre agents, pipelines et sessions.

Objectif :

- Factoriser les prompts longs.
- Versionner les rôles d'agents avec le code.
- Préparer un mécanisme propre de partage local des skills ou consignes projet.

Travail à prévoir :

- Résoudre les chemins relatifs depuis le fichier YAML.
- Refuser les chemins hors workspace sauf autorisation explicite.
- Afficher dans l'UI quel fichier d'instructions sera injecté.
- Prévoir une prévisualisation du prompt final avant lancement.

### 3. Sous-agents et reviewers déclaratifs (v1 implémentée ✅)

**Statut** : Implémenté dans ACP Client via la feature **Agent Teams** / **Équipes d'agents**.

Omnigent autorise un agent à déclarer des sous-agents comme outils. ACP Client a implémenté une approche similaire via `.acp/teams/*.yaml` qui compile vers le DSL pipeline v2 existant.

#### Fonctionnalités v1 livrées

- Définition d'équipes avec rôles `planner`, `implementer`, `reviewer`, et `tester` optionnel
- Chaque rôle peut utiliser un agent ACP différent
- Workflows "planifier → approuver → implémenter → relire → tester" configurables via YAML simple
- Compilation automatique vers pipeline v2 avec étapes d'approbation intégrées
- Affichage des rôles comme timeline dans le chat
- Commandes dédiées : `ACP: Show Compiled Team Pipeline` et `ACP: Re-run Team Reviewer`
- Intégration au sandbox : `implementer` s'exécute dans un worktree isolé si `acp.sandbox.enabled` est actif

Exemple v1 :

```yaml
version: 1
id: feature-team
title: Feature Team
orchestrator:
  agent: Codex CLI   # métadonnée v1, pas un agent LLM actif
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
  tester:            # optionnel
    agent: Codex CLI
    instructions: .acp/agents/tester.md
```

Voir la documentation complète : [doc_fr/agent-teams.md](../doc_fr/agent-teams.md)

#### Évolutions futures possibles

- Rôles personnalisables au-delà des 4 rôles v1
- Implémentateurs parallèles pour tâches simultanées
- Orchestrateur LLM actif au lieu de compilation statique
- Intégration plus poussée avec le registre d'agents
- Gestion des dépendances entre équipes

### 4. Comparaison multi-agent

Omnigent met en avant des agents qui interrogent plusieurs modèles ou harnesses et comparent leurs réponses. ACP Client pourrait ajouter un mode local de comparaison.

Objectif :

- Envoyer le même prompt à plusieurs agents ACP.
- Afficher les réponses côte à côte.
- Permettre une étape de synthèse ou de débat.
- Utiliser ce mode pour brainstorming, revue de plan, diagnostic et choix d'implémentation.

Travail à prévoir :

- Ajouter un profil `comparison` dans les pipelines.
- Créer un bloc UI côte à côte dans la webview.
- Gérer l'annulation simultanée de toutes les branches.
- Ajouter une synthèse optionnelle par un agent choisi.

### 5. Politiques déclaratives de sécurité

Omnigent possède un système de politiques avec verdicts `ALLOW`, `DENY` et `ASK`, applicable aux actions shell, fichiers, outils, budget et risques. ACP Client a déjà les permissions ACP et le sandbox, mais doit gagner en granularité.

Objectif :

- Remplacer progressivement le simple `ask` ou `allowAll` par des règles composables.
- Définir des politiques par workspace, profil d'agent, pipeline ou session.
- Bloquer ou demander confirmation pour les commandes risquées.
- Encadrer les accès fichiers, les commandes git, les changements de répertoire et le réseau.

Exemple cible :

```yaml
policies:
  shell:
    default: ask
    deny:
      - "rm -rf"
      - "git reset --hard"
  files:
    writable:
      - .
    readonly:
      - docs
  network:
    allow:
      - github.com
      - registry.npmjs.org
```

Travail à prévoir :

- Créer un moteur local de verdict `allow`, `deny`, `ask`.
- L'appliquer aux handlers `FileSystemHandler`, `TerminalHandler` et aux runs sandbox.
- Ajouter une UI de session pour voir les politiques actives.
- Journaliser les décisions dans les debug snapshots.

### 6. Budget et limites d'exécution

Omnigent propose des limites de coût et de nombre d'appels outils. Dans ACP Client, l'information coût dépend des agents ACP, mais des limites locales restent utiles.

Objectif :

- Limiter le nombre d'appels terminal/fichier par session.
- Limiter la durée maximale d'un run.
- Afficher un compteur d'actions et un état de budget de contexte.
- Stopper proprement les agents quand une limite est atteinte.

Travail à prévoir :

- Ajouter des compteurs par session dans `SessionState`.
- Définir des seuils configurables par workspace et profil.
- Envoyer un message clair à l'agent quand une limite bloque une action.
- Ajouter des tests sur annulation, timeout et blocage d'action.

### 7. Gestion des credentials et modèles par profil

Omnigent distingue clé API, abonnement CLI, gateway compatible OpenAI/Anthropic et configuration par agent. ACP Client dépend surtout des agents ACP installés, mais peut mieux modéliser les prérequis.

Objectif :

- Décrire pour chaque agent les prérequis d'installation et d'authentification.
- Associer un modèle, un mode et des options par profil.
- Détecter les commandes absentes ou credentials probablement manquants.
- Améliorer les messages d'erreur au lancement.

Travail à prévoir :

- Enrichir le registre d'agents avec `install`, `auth`, `healthCheck` et `models`.
- Ajouter une commande "Diagnostiquer cet agent".
- Afficher l'état prêt, absent, non authentifié ou erreur inconnue.
- Conserver les overrides par workspace.

### 8. Sandboxing renforcé

Omnigent sélectionne un sandbox OS selon la plateforme. ACP Client dispose déjà d'un sandbox par git worktree, qui protège surtout le workspace principal mais ne fournit pas une isolation OS complète.

Objectif :

- Garder le git worktree comme UX principale.
- Ajouter des garde-fous applicatifs plus stricts pour terminal, fichiers et réseau.
- Préparer plus tard une isolation OS optionnelle si elle reste simple à utiliser.

Travail à prévoir :

- Finaliser l'allowlist réseau applicative.
- Bloquer les chemins hors sandbox au niveau terminal quand c'est détectable.
- Ajouter un résumé clair des limites du sandbox dans l'UI.
- Evaluer une intégration macOS seatbelt ou container optionnel sans rendre le flux obligatoire.

### 9. Sessions attachables localement

Omnigent permet d'attacher une interface à une session existante. Sans aller vers le partage multi-user, ACP Client peut améliorer la reprise locale.

Objectif :

- Rendre la reprise de session plus fiable et visible.
- Permettre de rattacher la vue chat à une session active ou historique.
- Clarifier les sessions internes de pipeline et les sessions utilisateur.

Travail à prévoir :

- Ajouter une vue détaillée de session : agent, cwd, modèle, statut, dernier message.
- Ajouter une commande "Attacher à cette session locale".
- Mieux distinguer session active, session restaurée et session pipeline interne.
- Ajouter une recherche dans l'historique.

### 10. Exemples prêts à l'emploi

Omnigent fournit des exemples comme Polly et Debby pour montrer les workflows multi-agents. ACP Client devrait fournir des exemples locaux adaptés VS Code.

Objectif :

- Fournir des exemples concrets dans `.acp/examples` ou `docs/examples`.
- Accélérer l'adoption des pipelines et profils agents.
- Servir de tests manuels pour les scénarios multi-agents.

Exemples à créer :

- `plan-execute-review`: plan, approbation, implémentation sandbox, review.
- `compare-agents`: même prompt envoyé à deux agents, synthèse finale.
- `test-writer`: génération de tests puis validation.
- `doc-writer`: résumé de code et mise à jour documentation.

## Fonctionnalités Omnigent Hors Périmètre

- Cloud sandboxes provisionnés par serveur.
- Application web/mobile distante.
- Comptes utilisateurs, invitations et administration d'équipe.
- Partage public ou privé de sessions entre utilisateurs.
- Co-drive distant sur la machine d'un autre utilisateur.
- Fork distant d'une conversation vers une autre machine.
- Déploiement Docker/Railway/Fly/Render du serveur.

## Priorités Suggérées

1. Refaire le sandbox : architecture git worktree, handlers terminal/fichier, promotion Apply/Reject, policies applicatives et UX des limites (voir section 8 et `docs/plans/omnigent/08-stronger-sandboxing.md`).

1 trouver un moyen de partager les skill 
2 click stop dois tout stopper et ne pas laisser les agents continuer à répondre
3 bug sur la suppression d'un fichier ajouté en @ dans le text prompt
