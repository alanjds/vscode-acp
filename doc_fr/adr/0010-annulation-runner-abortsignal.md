# ADR-0010: Annulation runner via AbortSignal (inline + pipeline)

**Status**: Accepted

## Contexte

Le projet exécute des générations ACP via deux chemins principaux :

- **Runner éphémère** (spawn → connect → newSession → prompt → collect) pour :
  - les étapes **pipeline** (LangGraph) via `PipelineService` / `AcpAgentRunner`
  - l’**inline chat** (editor inset) via `AcpInlineEditAgent` / `AcpAgentRunner`
- **Session ACP persistante** (chat latéral) via `SessionManager.sendPrompt()` et `connection.cancel()`.

Avant cette décision :

- Le bouton **Stop** du chat latéral annulait bien une session ACP persistante, mais :
  - pour un pipeline, l’annulation était surtout **coopérative** (flag `cancelled`) et ne stoppait pas un `prompt()` déjà en cours.
- Fermer l’inline prompt (**×** ou **Esc**) disposait l’UI sans interrompre la génération : l’exécution continuait en arrière-plan.

Objectif : fournir une annulation robuste et cohérente :

- **Stop** interrompt l’exécution en cours.
- **× / Esc** dans l’inline prompt interrompent l’exécution en cours.
- Le pipeline peut interrompre l’étape ACP active (pas seulement les étapes suivantes).

## Décision

1. Standardiser l’annulation sur `AbortSignal` dans le runner éphémère (`AcpAgentRunner`).
2. Propager le signal :
   - de l’inline inset (Stop / × / Esc) vers `AcpInlineEditAgent` puis `AcpAgentRunner`
   - de `PipelineService.cancel()` / `rejectPlan()` / `dispose()` vers l’étape ACP en cours
3. Introduire une erreur dédiée `RunAbortedError` pour traiter proprement l’annulation (sans la confondre avec une erreur d’exécution).

## Notes d’implémentation

### Runner (`AcpAgentRunner`)

- `AcpAgentRunner.run(..., { signal })`
  - vérifie `signal.aborted` avant les étapes critiques (spawn/connect/newSession/prompt)
  - installe un listener `abort` (once) :
    - si `sessionId` est connu : `connection.cancel({ sessionId })`
    - fallback : `AgentManager.killAgent(...)` / `killAll()`
  - après `prompt()`, si abort : throw `RunAbortedError` plutôt que retourner du texte partiel

### Inline inset (éditeur)

- Un `AbortController` par génération.
- **Stop** :
  - abort
  - inset reste ouvert
  - reset UI (status `ready`)
- **Cancel** (× / Esc) :
  - abort
  - dispose l’inset
- `RunAbortedError` est silencieuse (pas de toast).

### Pipeline

- `PipelineService` maintient un `AbortController` par run.
- `cancel()` / `rejectPlan()` / `dispose()` appellent `abort()` pour interrompre l’étape ACP active.
- Le signal est transmis au runner (ou aux mocks `runAcpAgent` en tests).

### Chat latéral (UX)

- Après `cancelTurn`, le provider envoie `promptEnd` pour éviter un blocage UI en mode “processing”.

## Conséquences

### Positives

- Annulation effective d’exécutions ACP **en cours** (runner éphémère).
- Inline inset : **× / Esc** n’abandonnent plus une exécution en arrière-plan.
- Pipeline : Stop interrompt le `prompt()` actif, meilleure réactivité.

### Négatives / Risques

- Courses fin naturelle vs abort (mitigées par listener `once` + checks `signal.aborted`).
- Auth (UI modale) : abort doit pouvoir tuer l’agent si l’exécution est stoppée pendant l’auth (fallback kill).

## Alternatives considérées

- Annulation coopérative uniquement : insuffisant (ne stoppe pas un `prompt()` déjà lancé).
- Kill process uniquement : trop brutal ; on préfère `connection.cancel()` puis fallback kill.

