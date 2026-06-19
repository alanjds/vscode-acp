# Plan Feature 09 - Sessions attachables localement

## Inspiration Omnigent

Références :

- README, session visible depuis terminal/browser/mobile : https://github.com/omnigent-ai/omnigent#2-start-your-first-agent
- README, `omnigent attach` : https://github.com/omnigent-ai/omnigent#5-collaborate-with-your-team

La partie collaboration distante est hors périmètre, mais l'idée d'attacher une interface à une session existante est pertinente localement dans VS Code.

## Parallèle avec l'existant dans ACP Client

ACP Client a déjà une base forte pour les sessions locales :

- `src/core/SessionHistoryStore.ts` persiste l'historique par workspace ;
- `src/core/WorkspaceIdentity.ts` définit le scope workspace ;
- `src/core/SessionManager.ts` sait `loadSession`, `resumeSession` et gérer le fallback local ;
- `src/ui/SessionTreeProvider.ts` affiche agents et sessions ;
- `docs/adr/0006-workspace-scoped-session-history.md` documente la stratégie.

Omnigent met l'accent sur l'attachement d'interfaces multiples à une session. ACP Client doit reprendre seulement la version locale : mieux rattacher la webview à une session existante, sans partage distant ni multi-user.

Le parallèle direct est donc :

- Omnigent `attach` -> commande locale "Attach to Local Session" ;
- Omnigent session multi-interface -> webview VS Code reconnectée à une session ;
- Omnigent session URL/team -> hors périmètre ;
- Omnigent historique de session -> extension de `SessionHistoryStore` et tree view.

## Objectif ACP Client

Améliorer la reprise locale : voir les sessions actives/historiques, comprendre leur état et rattacher la vue chat à l'une d'elles.

## Intégration dans le code local

Points d'entrée existants :

- `src/core/SessionHistoryStore.ts`
- `src/core/SessionManager.ts`
- `src/core/WorkspaceIdentity.ts`
- `src/ui/SessionTreeProvider.ts`
- `docs/adr/0006-workspace-scoped-session-history.md`
- `docs/adr/0007-shared-context-handoff-and-context-families.md`

Changements proposés :

- Ajouter une vue détaillée de session : agent, cwd, modèle, statut, date, dernier message.
- Ajouter une commande "Attach to Local Session".
- Distinguer clairement : session active, session restaurée, session pipeline interne.
- Ajouter une recherche locale dans l'historique.
- Exposer les erreurs de reprise dans l'UI plutôt que dans le log uniquement.

## UX

- Clic sur une session : ouvre le détail.
- Double clic ou action : attache la vue chat.
- Badge pour session active.
- Filtre par agent, workspace, date et texte.

## Risques

- Tous les agents ACP ne supportent pas `session/list`, `loadSession` ou `resumeSession` de la même façon.
- La persistance locale peut diverger de l'état réel côté agent.
- Les sessions internes pipeline ne doivent pas polluer l'expérience principale.

## Découpage

1. Enrichir le modèle affiché en tree view.
2. Ajouter le détail session.
3. Ajouter recherche/filtres.
4. Ajouter tests sur fallback local vs agent-capability.
