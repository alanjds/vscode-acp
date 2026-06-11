# Plan : persistance locale multi-workspace

## Résumé

Remplacer le cache plat actuel `acp.sessionHistory.v1` par un store versionné qui indexe les sessions par `workspaceKey + agentName + sessionId`, avec un statut explicite.

L'objectif est de distinguer clairement :

- session disponible ;
- session supprimée côté agent ;
- agent retiré de la configuration ;
- agent configuré mais impossible à lancer.

## Changements clés

- Introduire une abstraction `WorkspaceIdentity` commune à `SessionManager` et `SessionTreeProvider`.
- Résoudre le workspace avec la même priorité partout :
  - `acp.defaultWorkingDirectory` si défini ;
  - sinon workspace folder actif ou premier folder ;
  - clé stable normalisée, plus `displayName` pour l'UI.
- Migrer `SessionHistoryStore` en `v2` avec les champs suivants :
  - `workspaceKey`
  - `cwd`
  - `agentName`
  - `agentFingerprint`
  - `sessionId`
  - `title`
  - `firstPrompt`
  - `createdAt`
  - `lastActiveAt`
  - `status`
- Utiliser les statuts :
  - `available`
  - `missing`
  - `agentUnavailable`
  - `agentRemoved`
- Migrer automatiquement les entrées v1 existantes vers v2.
- Ne plus supprimer immédiatement les sessions introuvables côté agent :
  - les marquer `missing` ;
  - les cacher par défaut dans la tree view ;
  - conserver `Forget Session` pour une suppression définitive.
- Gérer les agents indisponibles sans perte d'historique :
  - si l'agent n'est plus dans `acp.agents`, garder ses sessions en `agentRemoved` sans afficher l'agent dans la liste principale ;
  - si l'agent est configuré mais échoue au spawn/init, afficher un état temporaire d'erreur sans supprimer ses sessions.
- Corriger l'incohérence actuelle :
  - `SessionManager` utilise `defaultWorkingDirectory` ;
  - `SessionTreeProvider` filtre avec `workspaceFolders[0]` ;
  - les deux doivent utiliser exactement le même résolveur de cwd/workspace.

## Comportement UI

- Agent configuré avec sessions locales : affichage normal.
- Agent configuré mais non lançable : ligne agent avec état d'erreur et action retry.
- Session locale introuvable au `load/resume` : masquée de la vue normale après marquage `missing`, sans suppression physique immédiate.
- Agent supprimé de la configuration : sessions conservées dans le store, mais non affichées dans la vue principale.

## Plan de tests

- Tests unitaires `SessionHistoryStore` :
  - migration v1 vers v2 ;
  - filtrage par workspace ;
  - cap par agent et workspace ;
  - transition `available -> missing` ;
  - agent supprimé vs agent indisponible.
- Tests `SessionTreeProvider` :
  - même cwd que `SessionManager` avec `defaultWorkingDirectory` ;
  - multi-root workspace ;
  - session not found masquée après échec ;
  - agent indisponible affiché sans perte d'historique.
- Tests `SessionManager` :
  - `loadSession` et `resumeSession` marquent `missing` sur `not found` ;
  - erreurs de connexion agent sans suppression des sessions.

## Hypothèses

- On garde VS Code `Memento` comme backend local.
- Pas de fichier JSON externe pour l'instant.
- Les sessions supprimées côté agent ne doivent pas être perdues silencieusement.
- La vue principale doit rester propre : pas d'agents supprimés ni de sessions manquantes visibles par défaut.
