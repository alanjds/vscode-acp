# Mission : Comprendre vscode-acp-perso

> **Lire les leçons HTML :** [README.md](./README.md) — lancer le serveur local et ouvrir la [leçon 1](http://localhost:3000/lessons/0001-vue-ensemble-architecture.html).

## Pourquoi
Tu travailles sur (ou avec) cette extension VS Code qui connecte l'éditeur à des agents IA via le protocole ACP. Pour contribuer, déboguer ou étendre le projet avec confiance, tu dois savoir où vit chaque concept — chat, sessions, pipelines, Sandcastle — et comment les morceaux s'assemblent au démarrage.

## À quoi ressemble la réussite
- Expliquer le parcours utilisateur : connecter un agent → envoyer un prompt → voir la réponse streamée
- Nommer les quatre contextes (Core, Pipeline, Sandcastle, Inline chat) et ce qu'ils possèdent chacun
- Distinguer Conversation, SessionRecord, ChatHistory et Discussion sans confondre « session »
- Ouvrir le bon fichier quand un bug touche le chat, l'arbre des sessions ou une étape pipeline

## Contraintes
- Langue : français pour les leçons et échanges
- Priorité au code existant (`CONTEXT-MAP.md`, glossaires `src/*/CONTEXT.md`) plutôt qu'à la doc marketing
- Progression par petites leçons courtes, une compétence à la fois

## Hors périmètre (pour l'instant)
- Publication Marketplace / CI release
- Plans non implémentés (`docs/plans/omnigent/`)
- Détails internes du SDK ACP ou de LangGraph au niveau source
