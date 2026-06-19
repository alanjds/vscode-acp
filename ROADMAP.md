# Roadmap ACP Client

Cette roadmap regroupe les idées d'évolution et les possibilités pour ACP Client, une extension VS Code permettant de connecter l'éditeur à des agents compatibles avec l'Agent Client Protocol.

## Objectifs du Projet

- Offrir une interface VS Code fiable pour discuter avec des agents ACP depuis le workspace courant.
- Faciliter le passage d'un agent à un autre tout en conservant les sessions, l'historique et les options propres à chaque agent.
- Rendre les workflows agentiques plus sûrs grâce à une gestion claire des permissions, du contexte envoyé et des actions terminal/fichier.
- Explorer des scénarios multi-agents, notamment la séparation entre planification et implémentation.

## Priorités Court Terme

- Renforcer le sandbox v1 : compléter les garde-fous applicatifs sur le terminal et le réseau, expliciter ses limites dans l'UI et évaluer une isolation OS optionnelle.
- Stabiliser la liste des sessions et les mécanismes de reprise selon les capacités réellement exposées par chaque agent.
- Améliorer le contexte VS Code envoyé aux agents avec des contrôles plus visibles et une meilleure prévisibilité pour l'utilisateur.
- Renforcer les messages d'erreur autour du lancement des agents, de l'authentification et des commandes introuvables.
- Documenter plus clairement les agents préconfigurés, leurs prérequis et leurs limites.

## Possibilités Moyen Terme

- Ajouter des profils d'agents pour sauvegarder des combinaisons de modèle, mode, niveau de raisonnement, permissions et répertoire de travail.
- Proposer une recherche dans l'historique des sessions, avec filtres par agent, date, titre et contenu.
- Permettre l'export et l'import de sessions pour faciliter le partage ou l'archivage.
- Améliorer le pipeline planification puis implémentation avec un suivi plus détaillé des étapes, des statuts et des erreurs.
- Ajouter des modèles de prompts réutilisables pour les tâches fréquentes : revue de code, génération de tests, refactorisation, documentation.

## Idées Long Terme

- Expérimenter des workflows multi-agents où plusieurs agents peuvent comparer, critiquer ou compléter leurs réponses.
- Ajouter un mode de comparaison pour envoyer le même prompt à plusieurs agents et afficher les résultats côte à côte.
- Introduire des automatisations pilotées par session, par exemple relancer une vérification, générer un résumé ou préparer une suite de tâches.
- Étendre la compatibilité vers d'autres protocoles ou passerelles lorsque cela améliore l'interopérabilité avec l'écosystème agentique.

## Pistes Techniques et UX

- Augmenter la couverture de tests sur les flux critiques : sessions, reprise, permissions, contexte éditeur, webview et pipeline.
- Améliorer la persistance locale afin de mieux gérer les workspaces multiples, les sessions supprimées et les agents non disponibles.
- Durcir la politique de sécurité autour des accès fichiers, des commandes terminal et des approvals automatiques.
- Ajouter une télémétrie optionnelle centrée sur la fiabilité : erreurs de connexion, échecs de reprise, latence de session et causes d'annulation.
- Clarifier les états UI lorsque l'agent ne supporte pas certaines capacités ACP, au lieu de masquer implicitement les actions.

## Nouvelles Idées à Explorer

- Prévisualiser et éditer le contexte qui sera injecté avant l'envoi au nouvel agent.
- Conserver un historique des plans proposés, approuvés, rejetés ou modifiés.
- Comparer le plan approuvé avec les changements réellement produits par l'agent d'implémentation.
- Ajouter un centre de diagnostic capable de générer un bundle de support filtré à partir des snapshots de debug.
- Proposer des politiques de permissions par workspace ou par profil d'agent.

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

Les équipes d'agents savent déjà charger un fichier `instructions` relatif au workspace avec contrôle du chemin et de la taille. Ce mécanisme doit maintenant être généralisé au-delà des fichiers `.acp/teams/*.yaml`.

Objectif :

- Factoriser les prompts longs.
- Versionner les rôles d'agents avec le code.
- Préparer un mécanisme propre de partage local des skills ou consignes projet.

Travail à prévoir :

- Réutiliser `InstructionResolver` dans les futurs profils d'agents et les pipelines autonomes.
- Afficher dans l'UI quel fichier d'instructions sera injecté.
- Prévoir une prévisualisation du prompt final avant lancement.
- Définir un format partageable pour distribuer des ensembles d'instructions ou de skills avec un workspace.

### 3. Comparaison multi-agent

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

### 4. Politiques déclaratives de sécurité

Omnigent possède un système de politiques avec verdicts `ALLOW`, `DENY` et `ASK`, applicable aux actions shell, fichiers, outils et risques. ACP Client a déjà les permissions ACP et le sandbox, mais doit gagner en granularité.

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

### 5. Sandboxing renforcé

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

### 6. Gestion avancée des sessions locales

ACP Client sait déjà charger ou reprendre une session existante et rattacher le chat à celle-ci. La gestion locale doit encore gagner en lisibilité et en capacité de recherche.

> Piste intéressante : permettre de lancer une session dans un environnement non préparé, par exemple un conteneur Docker, puis d'y installer l'agent et d'y effectuer son authentification. Cette piste devra être cadrée pour éviter de stocker ou de manipuler directement les secrets dans l'extension.

Objectif :

- Clarifier les sessions internes de pipeline et les sessions utilisateur.
- Retrouver rapidement une session locale ou distante.

Travail à prévoir :

- Ajouter une vue détaillée de session : agent, cwd, modèle, statut, dernier message.
- Mieux distinguer session active, session restaurée et session pipeline interne.
- Ajouter une recherche dans l'historique.

### 7. Exemples prêts à l'emploi

ACP Client contient déjà des pipelines dans `.acp/pipelines/save` et une équipe d'exemple dans `.acp/teams`. Il reste à transformer cette collection en exemples documentés et faciles à découvrir.

Objectif :

- Fournir des exemples concrets dans `.acp/examples` ou `docs/examples`.
- Accélérer l'adoption des pipelines et profils agents.
- Servir de tests manuels pour les scénarios multi-agents.

Travail à prévoir :

- Sélectionner un petit catalogue d'exemples stables et les documenter.
- Ajouter un exemple de comparaison multi-agent avec synthèse finale.
- Ajouter des tests manuels reproductibles pour chaque exemple publié.



## Priorités Suggérées

1. Renforcer le sandbox au-delà de la v1 : policies applicatives, contrôle réseau, UX des limites et isolation OS optionnelle (voir section 5 et `docs/plans/omnigent/08-stronger-sandboxing.md`).
2. Généraliser et documenter le partage d'instructions ou de skills entre profils, pipelines et workspaces.
