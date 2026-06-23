# Plan — ActiveAgentResolver pour InlineEdit

> Réduire le couplage inline chat → SessionManager et rendre testable le cycle de vie `InlineEditSession` (submit / accept / stale / abort).

**Statut :** implémenté  
**Date :** 2026-06-23  
**Contexte :** revue d’architecture post-refactor (candidat #7, force Worth exploring)  
**Alignement :** ADR-0009 (séparation UI ↔ agent), `src/inlineChat/CONTEXT.md` (chemin parallèle EphemeralRun)

---

## 1. Problème

L’inline edit résout **quel agent ACP exécuter** en important tout `SessionManager`, alors que le besoin se limite à **lire le ConnectedAgent actif** (ou un fallback configuré).

```
InlineEditSession → AcpInlineEditAgent → SessionManager.getActiveSession()?.agentName
                                      → EphemeralAgentRunner.run(...)
```

### Symptômes concrets

1. **Leakage inline → SessionManager** — `AcpInlineEditAgent` dépend de ~450 LOC (connect, open, prompt, ingest…) pour deux appels :
   - `resolveAgentName()` — choix de l’agent runnable
   - `getDisplayName()` — libellé affiché dans l’inset (`status.thinking`)
2. **Chemin parallèle mal documenté au code** — `CONTEXT.md` dit qu’InlineEdit ne crée pas de Conversation et partage EphemeralRun avec le pipeline, mais le code réutilise la notion de « session chat active » sans seam explicite.
3. **Tests déséquilibrés** — `PatchDecision` est couvert (`PatchDecision.test.ts`) ; `InlineEditAbort.test.ts` ne teste que l’agent mock. **`InlineEditSession` n’a aucun test** alors qu’elle orchestre submit → proposal → accept/reject/stop/abort.
4. **Régression invisible** — un changement sur `SessionManager.getActiveSession()` ou le filtrage VirtualAgent peut casser l’inline edit sans test ciblé.

### Fichiers impliqués aujourd’hui

```
src/inlineChat/agent/AcpInlineEditAgent.ts   ← import SessionManager, resolveAgentName
src/inlineChat/InlineEditSession.ts          ← orchestration sans tests
src/inlineChat/patch/PatchDecision.ts        ← pur, testé ✓
src/plugins/inlineChat/InlineChatPlugin.ts   ← wiring SessionManager → AcpInlineEditAgent
src/test/PatchDecision.test.ts               ← accept / stale / empty
src/test/InlineEditAbort.test.ts             ← abort au niveau agent seulement
```

### Règle métier à figer (déjà dans CONTEXT.md)

> Le ConfiguredAgent par défaut pour un InlineEdit est le **ConnectedAgent actif** s’il n’est pas VirtualAgent ; sinon le **premier ConfiguredAgent non virtual** du workspace.

---

## 2. Objectif

### ActiveAgentResolver

**Module mince, local-substitutable** : une interface étroite qui encapsule la règle ci-dessus sans exposer SessionManager aux consommateurs inline.

**Responsabilité unique :** à partir du workspace courant et de l’état « agent actif » (injecté), retourner l’agent **runnable** pour un EphemeralRun inline.

**Hors périmètre :**

- Exécution EphemeralRun (`EphemeralAgentRunner`) — reste chez `AcpInlineEditAgent`
- Construction du prompt / parsing réponse — reste dans `AcpInlineEditAgent`
- Décision patch (`PatchDecision`) — déjà extrait
- UI inset (`InlineChatInset`) — inchangée sauf wiring

### InlineEditSession — surface de test

Couvrir le **cycle de vie** de la session (messages webview ↔ agent ↔ patch), pas seulement la logique patch pure.

---

## 3. Interface proposée

### 3.1 Types

```typescript
/** Agent choisi pour un InlineEdit (EphemeralRun, sideEffects: 'none'). */
export type RunnableInlineAgent = {
  /** Nom technique passé à EphemeralAgentRunner.run({ agentName }). */
  name: string;
  /** Libellé UI (status thinking, inset header). */
  displayName: string;
};

export interface ActiveAgentResolver {
  /** Résout l’agent à exécuter pour un inline edit dans le workspace courant. */
  resolveRunnableAgent(): RunnableInlineAgent;
}
```

### 3.2 Implémentation production

**Fichier :** `src/inlineChat/agent/ActiveAgentResolver.ts` (ou `src/config/` si réutilisation future hors inline)

```typescript
export class SessionBackedActiveAgentResolver implements ActiveAgentResolver {
  constructor(
    private readonly workspaceCwd: () => string,
    private readonly getActiveAgentName: () => string | undefined,
  ) {}

  resolveRunnableAgent(): RunnableInlineAgent {
    const cwd = this.workspaceCwd();
    const activeName = this.getActiveAgentName();

    if (activeName && !isVirtualAgentName(activeName, cwd)) {
      return this.toRunnable(activeName);
    }

    const fallback = listSelectableAgentNames(cwd).find(
      name => resolveAgent(name, cwd)?.kind === 'configured',
    );
    if (!fallback) {
      throw new Error('No ACP agent configured. Add agents in acp.agents settings.');
    }
    return this.toRunnable(fallback);
  }

  private toRunnable(name: string): RunnableInlineAgent {
    const cfg = getAgentConfig(name);
    return { name, displayName: cfg?.displayName ?? name };
  }
}
```

**Wiring dans `InlineChatPlugin` :**

```typescript
const resolver = new SessionBackedActiveAgentResolver(
  () => context.workspaceIdentity().cwd,
  () => context.sessionManager.getActiveSession()?.agentName,
);
new AcpInlineEditAgent(context.workspaceIdentity, resolver, ephemeralRunner);
```

### 3.3 Refactor `AcpInlineEditAgent`

| Avant | Après |
|-------|-------|
| `constructor(..., sessionManager: SessionManager, ...)` | `constructor(..., resolver: ActiveAgentResolver, ...)` |
| `resolveAgentName()` privé + logique VirtualAgentCatalog | `this.resolver.resolveRunnableAgent().name` |
| `getDisplayName()` lit SessionManager | `this.resolver.resolveRunnableAgent().displayName` |

Supprimer l’import `SessionManager` de `AcpInlineEditAgent.ts`.

---

## 4. Placement du seam

```
┌─────────────────────┐
│  InlineChatPlugin   │
└──────────┬──────────┘
           │ fabrique
           ▼
┌──────────────────────────────┐     ┌─────────────────────┐
│ SessionBackedActiveAgent     │◄────│ SessionManager      │
│ Resolver (adapter mince)     │     │ getActiveSession()  │
└──────────┬───────────────────┘     └─────────────────────┘
           │
           ▼
┌──────────────────────┐     ┌─────────────────────┐
│ AcpInlineEditAgent   │────►│ EphemeralAgentRunner │
└──────────┬───────────┘     └─────────────────────┘
           │
           ▼
┌──────────────────────┐     ┌─────────────────────┐
│ InlineEditSession    │────►│ PatchDecision       │
└──────────────────────┘     └─────────────────────┘
```

- **Seam externe (testable) :** `ActiveAgentResolver.resolveRunnableAgent()`.
- **Un adapter production :** `SessionBackedActiveAgentResolver` — justifie le seam (substitution en tests).
- **SessionManager** reste le propriétaire de l’état session ; l’inline ne voit qu’une fonction `() => agentName | undefined`.

---

## 5. Phases d’implémentation

### Phase 0 — Figer la règle de résolution (tests)

**Fichier :** `src/test/ActiveAgentResolver.test.ts` (nouveau)

| Cas | Entrée | Résultat attendu |
|-----|--------|------------------|
| ConnectedAgent natif actif | `active = 'claude'`, configured | `{ name: 'claude', displayName: ... }` |
| VirtualAgent actif | `active = 'feature-team'`, team | premier configured non virtual |
| Aucune session active | `active = undefined` | premier configured |
| Workspace sans agent | liste vide | throw explicite |
| DisplayName manquant | agent sans `displayName` config | `displayName === name` |

Extraire la logique actuelle de `AcpInlineEditAgent.resolveAgentName()` **sans modifier les appelants** ; faire passer les tests contre l’implémentation extraite.

### Phase 1 — Créer le module + brancher l’agent

1. Ajouter `ActiveAgentResolver.ts` + `SessionBackedActiveAgentResolver`.
2. Refactorer `AcpInlineEditAgent` pour utiliser le resolver.
3. Mettre à jour `InlineChatPlugin` (wiring).
4. Vérifier que `AcpInlineEditAgent` n’importe plus `SessionManager`.

### Phase 2 — Tests `InlineEditSession`

**Fichier :** `src/test/InlineEditSession.test.ts` (nouveau)

Utiliser un **host mock** (`InlineEditSessionHost`) et un **agent mock** (`MockInlineEditAgent` ou stub dédié).

| Test | Comportement |
|------|--------------|
| `submit` success | `post({ type: 'status', value: 'thinking' })` puis `post({ type: 'proposal', ... })` |
| `submit` agent error | `post({ type: 'status', value: 'error' })`, `showError` appelé |
| `submit` abort avant fin | pas de proposal, pas d’error |
| `accept` applied | `decidePatchAcceptance` → `host.close()` |
| `accept` stale | `showWarning`, pas de close |
| `reject` / `cancel` | `abort` agent, `host.close()` |
| `stop` | abort agent, `post({ type: 'status', value: 'ready' })` |
| double `submit` | second run annule le premier (`AbortController`) |

**Note :** mocker `vscode.TextEditor` comme dans `PatchDecision.test.ts` ; optionnellement spy sur `decidePatchAcceptance` si besoin d’isoler apply.

### Phase 3 — Documentation

| Action | Fichier |
|--------|---------|
| Documenter **ActiveAgentResolver** et le chemin parallèle | `src/inlineChat/CONTEXT.md` |
| Mentionner le seam dans la carte contexte si pertinent | `CONTEXT-MAP.md` |

### Phase 4 (optionnelle) — Réutilisation

Si d’autres call sites ont besoin de la même règle (ex. futur prompt coordinator), déplacer l’interface vers `src/config/` ou `src/core/` et réexporter depuis inline. **Ne pas faire** tant qu’un seul consommateur existe.

---

## 6. Matrice de tests (récap)

### `ActiveAgentResolver.test.ts`

```text
active configured non virtual → name + displayName
active virtual team → fallback configured
no active session → fallback configured
no configured agents → Error
displayName from AgentConfig
```

### `InlineEditSession.test.ts`

```text
submit → thinking → proposal
submit error → error status + showError
submit aborted → silent return
accept applied → close
accept stale → warning, stay open
reject → close + abort
stop → ready status
concurrent submit → prior run aborted
```

### Tests existants — non-régression

- `PatchDecision.test.ts` — inchangé
- `InlineEditAbort.test.ts` — inchangé (niveau agent)
- Suite extension globale

---

## 7. Risques et mitigations

| Risque | Mitigation |
|--------|------------|
| Divergence resolver vs ancienne logique `resolveAgentName` | Phase 0 : copier comportement exact avant refactor |
| Tests InlineEditSession fragiles (mock VS Code) | Réutiliser patterns `PatchDecision.test.ts` ; host injecté |
| Sur-ingénierie (interface pour un seul appelant) | Interface mince (1 méthode) ; pas de factory tant que 1 adapter |
| VirtualAgentCatalog évolue | Tests table-driven sur les 3 cas active / virtual / fallback |

---

## 8. Critères de succès

- [x] `AcpInlineEditAgent` n’importe plus `SessionManager`.
- [x] `ActiveAgentResolver.test.ts` couvre active / virtual / fallback / erreur.
- [x] `InlineEditSession.test.ts` couvre submit, accept (applied + stale), reject, stop, abort.
- [x] `InlineChatPlugin` wire `SessionBackedActiveAgentResolver` explicitement.
- [x] `src/inlineChat/CONTEXT.md` documente **ActiveAgentResolver** comme seam de sélection d’agent.
- [x] Tests existants `PatchDecision`, `InlineEditAbort` passent sans régression.

---

## 9. Estimation d’effort

| Phase | Effort |
|-------|--------|
| 0 — Tests résolution | 0,25 j |
| 1 — Module + refactor agent | 0,25 j |
| 2 — Tests InlineEditSession | 0,5 j |
| 3 — CONTEXT | 0,1 j |
| **Total** | **~1 j** |

---

## 10. Ordre recommandé avec les autres candidats

Indépendant des candidats #2–#4 (Ephemeral connect, PipelineRunEngine, OrchestrationState). ConversationProjector (#1) est implémenté.

Peut être mené **en parallèle** ou **après** Ephemeral connect partagé (#2) : les deux touchent `EphemeralAgentRunner`, mais ce plan ne modifie pas le runner.

Priorité rapport : **#7 / Worth exploring** — utile pour la testabilité inline, pas bloquant pour la parité native/virtual.

---

## 11. Références

- `src/inlineChat/agent/AcpInlineEditAgent.ts` — couplage actuel
- `src/inlineChat/InlineEditSession.ts` — cycle de vie à tester
- `src/inlineChat/patch/PatchDecision.ts` — précédent extraction réussie
- `src/inlineChat/CONTEXT.md` — règle ConnectedAgent / VirtualAgent
- `doc_fr/adr/0009-inline-chat-editor-inset.md` — séparation UI ↔ agent
- Revue architecture : `architecture-review-20260623-094322.html` (candidat #7)
