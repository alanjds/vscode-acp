# Isolation Sandcastle

Exécution d’agent dans Docker avec worktree git jetable et promotion explicite des changements de fichiers vers le workspace de l’utilisateur.

## Runtime

**IsolatedRuntime** :
Mode d’exécution où l’agent travaille dans Docker et un worktree sandbox au lieu d’écrire directement dans le workspace. Exposé comme ConfiguredAgent Sandcastle avec transport `sandcastle`.
_À éviter_ : sandbox (seul), agent docker, mode conteneur

**ConnectedSandcastleAgent** :
ConnectedAgent dont le transport est `sandcastle` : un processus bridge ACP longue durée par connexion, réutilisable sur les prompts d’une même Conversation.
_À éviter_ : session sandcastle (ambigu)

**BridgeConversation** :
Côté bridge : association d’un id ProtocolSession avec une sandbox Docker et un transcript en mémoire utilisé uniquement pour reconstruire ce que le provider voit à chaque prompt.
_À éviter_ : session (nu), bridge session

## Historique

**BridgeTranscript** :
Séquence locale au bridge, bornée, de tours texte user/assistant injectée à chaque exécution provider dans Sandcastle. Indépendante de la Discussion sur SessionRecord — le bridge n’hydrate pas depuis la Discussion côté client dans le produit actuel.
_À éviter_ : discussion, historique de chat, mémoire de session

**ProviderRun** :
Une invocation du CLI dans la sandbox pour un seul prompt utilisateur. Sandcastle ne reprend pas l’état de session provider natif entre les runs ; la continuité est approximative via BridgeTranscript uniquement.
_À éviter_ : tour (sens Core), round de prompt

## Effets sur le workspace

**Worktree** :
Checkout git isolé où l’agent modifie les fichiers jusqu’à promotion ou rejet par l’utilisateur.
_À éviter_ : dossier sandbox, répertoire temporaire

**Promotion** :
Décision utilisateur d’appliquer les changements du worktree isolé dans le vrai workspace (Apply) ou de les rejeter et démonter la sandbox (Reject). Efface le BridgeTranscript pour cette BridgeConversation. Côté bridge, `WorktreePromotion` calcule le diff worktree (`previewWorktreeChanges`) et applique le patch sur le dépôt hôte (`applyWorktreeToHost`) ; `SandcastleAcpAgent` orchestre ces opérations via les handlers `sandcastle/preview` et `sandcastle/apply`. Côté extension, `SandcastlePromotion` orchestre aussi `finishEphemeralRun` après un EphemeralRun (discard silencieux ou gate Promotion selon `sideEffects`).
_À éviter_ : merge, commit, sync

**ShowDiff** :
Inspection des changements worktree en attente avant Promotion.
_À éviter_ : aperçu, vue diff (générique)

## Relations avec Core

- Du point de vue utilisateur, une Conversation Sandcastle ressemble à tout autre chat : même arbre, même ChatHistory streamée depuis les mises à jour ACP.
- Ce qui diffère : isolation filesystem, absence de `session/load` / `session/resume` natifs sur le bridge, et BridgeTranscript séparé pour le contexte provider.
- Le ContextHandoff depuis Discussion fonctionne toujours au niveau extension ; il n’alimente pas automatiquement le BridgeTranscript.
