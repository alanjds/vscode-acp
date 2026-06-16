# ADR-0010: Runner cancellation via AbortSignal (inline + pipeline)

**Status**: Accepted

## Context

Le projet exécute des générations ACP via deux chemins principaux :

- **Runner éphémère** (spawn → connect → newSession → prompt → collect) pour :
  - les étapes **pipeline** (LangGraph) via `PipelineService` / `AcpAgentRunner`
  - l’**inline chat** (editor inset) via `AcpInlineEditAgent` / `AcpAgentRunner`
- **Session ACP persistante** (sidebar chat) via `SessionManager.sendPrompt()` et `connection.cancel()`.

Avant cette décision :

- Cliquer sur **Stop** dans le chat latéral annulait bien une session ACP persistante, mais :
  - pour un pipeline, l’annulation était surtout **coopérative** (flag `cancelled`) et ne stoppait pas un `prompt()` déjà en cours.
- Fermer l’inline inset (**×** ou **Esc**) ne faisait que disposer l’UI ; la génération continuait en arrière-plan et pouvait encore produire un résultat, sans possibilité d’interruption.

Nous voulons une annulation robuste et cohérente :

- **Stop** doit interrompre l’exécution en cours.
- **× / Esc** dans l’inline prompt doivent interrompre l’exécution en cours.
- Le pipeline doit pouvoir interrompre l’étape ACP active (pas seulement les étapes suivantes).

## Decision

1. **Standardiser l’annulation sur `AbortSignal`** dans le runner éphémère (`AcpAgentRunner`).
2. **Propager le signal** :
   - de l’inline inset (Stop / × / Esc) vers `AcpInlineEditAgent` puis `AcpAgentRunner`
   - de `PipelineService.cancel()` / `rejectPlan()` / `dispose()` vers l’étape ACP en cours
3. Définir une erreur dédiée d’annulation `RunAbortedError` pour traiter proprement ce cas (sans le confondre avec des erreurs d’exécution).

## Implementation notes

### Runner (`AcpAgentRunner`)

- `AcpAgentRunner.run(..., { signal })`
  - vérifie `signal.aborted` avant les étapes critiques (spawn/connect/newSession/prompt)
  - installe un listener `abort` (once) :
    - si `sessionId` est connu : `connection.cancel({ sessionId })`
    - fallback : `AgentManager.killAgent(...)` / `killAll()`
  - à la fin de `prompt()`, si abort : throw `RunAbortedError` (au lieu de retourner une sortie partielle)

### Inline inset (editor)

- L’inset possède un `AbortController` par génération.
- **Stop** :
  - abort le controller
  - garde l’inset ouvert
  - reset l’état UI (status `ready`)
- **Cancel** (× / Esc) :
  - abort le controller
  - dispose l’inset
- Les erreurs d’annulation (`RunAbortedError`) sont silencieuses : pas de toast d’erreur.

### Pipeline

- `PipelineService` maintient un `AbortController` par run.
- `cancel()` / `rejectPlan()` / `dispose()` appellent `abort()` pour interrompre l’étape ACP active.
- Le signal est transmis à `AcpAgentRunner.run()` (ou aux mocks `runAcpAgent` en tests).

### Sidebar chat (UX)

- Après `cancelTurn`, le provider envoie `promptEnd` pour éviter que l’UI reste bloquée en mode “processing”.

## Consequences

### Positive

- Annulation réelle des exécutions ACP **en cours** (runner éphémère), pas uniquement “best effort”.
- Inline inset : **× / Esc** n’abandonnent plus une exécution en arrière-plan.
- Pipeline : Stop interrompt le `prompt()` actif, ce qui améliore la réactivité perçue.

### Negative / Risks

- Course conditions possibles entre fin naturelle et abort (mitigé par listener `once` + checks `signal.aborted`).
- L’auth (UI modale) peut être en cours : abort doit tuer l’agent si l’utilisateur annule l’exécution (fallback `killAgent`).

## Alternatives considered

- **Flag coopératif uniquement** (déjà existant côté pipeline) : insuffisant car ne stoppe pas un `prompt()` déjà lancé.
- **Kill process seulement** : brut, peut laisser la couche protocolaire dans un état inattendu ; on préfère tenter `connection.cancel()` puis fallback kill.

