# Roadmap ACP Client

Cette roadmap regroupe les idées d'évolution et les possibilités pour ACP Client, une extension VS Code permettant de connecter l'éditeur à des agents compatibles avec l'Agent Client Protocol.

## Objectifs du Projet

- Offrir une interface VS Code fiable pour discuter avec des agents ACP depuis le workspace courant.
- Faciliter le passage d'un agent à un autre tout en conservant les sessions, l'historique et les options propres à chaque agent.
- Rendre les workflows agentiques plus sûrs grâce à une gestion claire des permissions, du contexte envoyé et des actions terminal/fichier.
- Explorer des scénarios multi-agents, notamment la séparation entre planification et implémentation.

## Priorités Court Terme

- Stabiliser la liste des sessions et les mécanismes de reprise selon les capacités réellement exposées par chaque agent.
- Améliorer le contexte VS Code envoyé aux agents avec des contrôles plus visibles et une meilleure prévisibilité pour l'utilisateur.
- Finaliser l'expérience des mentions de fichiers dans le composer afin de remplacer complètement l'ancien flux d'attachement.
- Renforcer les messages d'erreur autour du lancement des agents, de l'authentification et des commandes introuvables.
- Documenter plus clairement les agents préconfigurés, leurs prérequis et leurs limites.

## Possibilités Moyen Terme

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

## Priorités Suggérées

1. Fiabiliser les fonctionnalités déjà visibles : sessions, contexte VS Code, mentions de fichiers et erreurs de connexion.
2. Documenter les nouveaux workflows, en particulier le pipeline A2A et les options `acp.pipeline.*`.
3. Améliorer l'ergonomie du chat avant d'ajouter des scénarios multi-agents plus avancés.
4. Étendre les tests automatisés sur les comportements qui dépendent des capacités variables des agents.
