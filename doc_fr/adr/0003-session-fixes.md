# ADR-0003 : corrections de gestion des sessions

**Statut** : Acceptée

## Contexte
La première gestion des sessions avait plusieurs problèmes :

1. **Conditions de course** : la réponse `newSession` et les notifications `session/update` arrivaient dans un ordre imprévisible, ce qui faisait afficher un état obsolète dans l'UI.
2. **Duplication d'état** : les informations de session étaient stockées à plusieurs endroits (`SessionManager`, tree view, webview de chat), ce qui créait des incohérences.
3. **Buffering manquant** : les notifications arrivant avant l'enregistrement de la session étaient perdues.
4. **Pas de suivi de cycle de vie** : impossible de distinguer les états connexion en cours, connecté et déconnecté.

Cela provoquait des historiques de chat vides, de mauvais noms d'agents affichés et des commandes qui échouaient silencieusement.

## Décision
Implémentation d'une gestion centralisée des sessions avec les patterns suivants :

**Source de vérité unique** :
- `SessionManager` possède tout l'état de session.
- La tree view et la webview s'abonnent aux mises à jour via event emitter.
- Pas d'accès direct à l'état, uniquement via l'API de `SessionManager`.

**Buffering des notifications** :
- les maps `pendingAvailableCommands`, `pendingConfigOptions`, `pendingTitles` mettent les notifications en buffer ;
- elles sont drainées lorsque la session correspondante est enregistrée via `createAcpSession` ;
- cela évite la perte de données pendant la course d'initialisation.

**États de cycle de vie** :
- suivi explicite : connexion en cours -> connecté -> déconnexion en cours -> déconnecté ;
- maps séparées pour les sessions (`sessions`) et le lien agent-session (`agentSessions`) ;
- `activeSessionId` suit la session courante pour le mode mono-agent.

**Flux de connexion** :
```
AgentManager.spawn() -> ConnectionManager.connect() -> SessionManager.ensureConnected()
                                    ↓
                              SessionManager.createAcpSession()
                                    ↓
                              Draine les buffers en attente
                                    ↓
                              Émet les événements de mise à jour
```

## Conséquences
**Positives** :
- Les notifications reçues avant `createAcpSession` sont mises en buffer puis drainées.
- Tree view et webview consomment l'état via `SessionManager`, ce qui évite la duplication d'état.

**Négatives** :
- Flux d'initialisation plus complexe.
- Buffers à nettoyer à la suppression d'une session.

## Alternatives envisagées
- Redux/RxJS - rejetés car ils ajoutent une infrastructure/dépendance pour un état local déjà centralisé dans `SessionManager`.
- Plus de locks - rejeté car cela ne règle pas les notifications reçues avant l'enregistrement de session.
