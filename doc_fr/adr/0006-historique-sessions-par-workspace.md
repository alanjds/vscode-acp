# ADR-0006 : historique des sessions par workspace

**Statut** : Acceptée

## Contexte
L'historique des sessions était stocké dans une portée globale via `acp.sessionHistory.v1`. Quand le même agent est utilisé dans plusieurs workspaces, cela mélange des sessions sans rapport et rend l'arbre peu fiable. L'extension a aussi besoin d'une identité de workspace commune pour que `SessionManager`, `SessionTreeProvider` et l'historique persisté résolvent la même portée.

## Décision
Introduire `WorkspaceIdentity` comme identité commune pour la portée des sessions. Résoudre le workspace dans cet ordre :
1. `acp.defaultWorkingDirectory`
2. Le dossier de workspace de l'éditeur actif, sinon le premier dossier de workspace
3. `process.cwd()`

Migrer l'historique local de `acp.sessionHistory.v1` vers `acp.sessionHistory.v2`. Persister les entrées avec un `workspaceKey` normalisé, `cwd`, `agentName` et `sessionId`, afin que les recherches soient limitées au workspace et à l'agent.

Conserver un statut local de cycle de vie pour chaque session en cache :
- `available` - la session est présente et accessible
- `missing` - la session est introuvable
- `agentUnavailable` - l'agent n'est pas disponible
- `agentRemoved` - l'agent a été supprimé

Afficher seulement les sessions disponibles par défaut, mais conserver les enregistrements obsolètes pour éviter de détruire l'historique silencieusement. `Forget Session` reste l'action explicite de suppression.

## Conséquences
**Positives** :
- Empêche les sessions de workspaces différents d'apparaître ensemble.
- Donne la même portée de workspace à la création, au chargement et au rendu de l'arbre.
- Préserve l'historique local existant via la migration.
- Évite la suppression silencieuse quand un agent ne peut pas lister ou reprendre une session.

**Négatives** :
- Nécessite une migration du stockage v1 vers v2.
- Ajoute une logique de statut et de réconciliation au cache local.
- La résolution du workspace peut rester ambiguë lorsqu'aucun workspace VS Code n'est ouvert.

## Alternatives considérées
- Garder une liste globale et filtrer par `cwd` au rendu - rejeté car la création et la recherche de session n'auraient pas d'identité partagée stable.
- Créer des clés de memento séparées par workspace - rejeté car la migration et le nettoyage deviennent plus difficiles qu'avec un seul store versionné.
- Supprimer automatiquement les sessions manquantes - rejeté car une panne transitoire d'agent entraînerait une perte de données.
- Conserver v1 inchangé - rejeté car il ne prend pas en charge l'historique par workspace.
