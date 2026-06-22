# Sandcastle — rapport de changements (POC)

**Portée :** ~35 fichiers, +2678 / −96 lignes  
**Objectif :** intégrer [Sandcastle](https://github.com/ai-hero-dev/sandcastle) pour exécuter **Codex** et **Cursor CLI** dans Docker, derrière le même protocole ACP que les autres agents.

Voir aussi :

- [Architecture](sandcastle-architecture.md)
- [Guide de premier test](sandcastle-first-test.md)
- [ADR-0013](adr/0013-acp-sandcastle-bridge.md)
- [ADR-0014](adr/0014-sandcastle-bounded-prompt-history.md)

---

## 1. Résumé exécutif

Avant, l'extension parlait uniquement à des agents ACP lancés **sur l'hôte** (npx, CLI natifs). Le sandbox legacy (ADR-0011) isolait le **répertoire de travail** via un git worktree, mais l'agent tournait toujours sur la machine.

Avec Sandcastle, **Codex** et **Cursor** peuvent tourner dans un **conteneur Docker** avec un worktree Git dédié. Les modifications restent isolées jusqu'à une action explicite **Apply** ou **Reject**.

L'extension ne change pas d'interface utilisateur globale : le chat ACP reste le même. Ce qui change, c'est **où** et **comment** certains agents s'exécutent, plus un **flux de promotion** des changements.

---

## 2. Ce qui change fonctionnellement

### 2.1 Deux nouveaux agents préconfigurés

| Agent | Runtime |
|-------|---------|
| **Codex Sandcastle** | Docker + `codex("gpt-5.4")` |
| **Cursor Sandcastle** | Docker + `cursor("composer-2")` |

Les agents ACP natifs existants **ne sont pas supprimés**. On choisit explicitement un agent dont le nom se termine par « Sandcastle ».

### 2.2 Nouveau modèle d'isolation

```text
Chat VS Code  →  ACP (stdio)  →  bridge Node  →  @ai-hero/sandcastle
                                              →  Docker + worktree Git
                                              →  Codex CLI ou Cursor Agent CLI
```

- **Une session ACP = un sandbox Docker réutilisable** sur une branche `sandcastle/acp/<provider>/<uuid>`.
- Le workspace principal **n'est pas modifié** tant que l'utilisateur n'applique pas les changements.
- Les prompts sont **sérialisés** par session (un seul prompt actif à la fois).
- L'annulation coupe le run Sandcastle en cours.

### 2.3 Promotion des changements (nouveau workflow)

Après un run qui modifie des fichiers :

1. **ACP: Sandcastle Show Diff** — affiche le patch binaire Git.
2. **ACP: Sandcastle Apply Changes** — `git apply --check` puis application sur le workspace principal ; nettoyage du worktree ; fermeture du sandbox.
3. **ACP: Sandcastle Reject Changes** — abandon sans toucher au workspace principal.

Pour les runs **pipeline / inline** avec un agent Sandcastle, la même boîte de dialogue (View Diff / Apply / Reject) s'ouvre automatiquement à la fin.

### 2.4 Historique de conversation

Sandcastle 0.6.4 ne gère pas le resume natif sur `createSandbox().run()`. Le bridge **reconstruit** un historique texte borné :

- 16 derniers messages max (8 tours user/assistant),
- 64 KiB max,
- injecté dans le prompt suivant sous forme de transcript.

Pas de reprise de session native côté provider pour l'instant. Voir [ADR-0014](adr/0014-sandcastle-bounded-prompt-history.md).

### 2.5 Erreurs plus lisibles

Le chat affiche des messages enrichis pour :

- quota / rate limit Codex,
- erreurs d'authentification (clé API manquante ou invalide),

avec des indications d'action (ex. vérifier `.sandcastle/.env`).

### 2.6 Ce qui ne change pas

- Agents ACP classiques (`transport` absent ou `"acp"`) : inchangés.
- Sandbox legacy (`acp.sandbox.enabled`) : **retiré** — utiliser Sandcastle pour l'isolation.
- Pipelines, teams, permissions, traffic ACP : inchangés dans le principe.

---

## 3. Prérequis utilisateur

| Prérequis | Détail |
|-----------|--------|
| **Docker** | Daemon actif |
| **Image locale** | `acp-client-sandcastle:local` (build via `.sandcastle/Dockerfile`) |
| **Secrets** | `.sandcastle/.env` avec `OPENAI_API_KEY` et `CURSOR_API_KEY` (gitignored) |
| **macOS/Linux** | Build Docker avec `AGENT_UID` / `AGENT_GID` pour éviter les problèmes de permissions sur les volumes |

Scripts de validation :

```bash
npm run sandcastle:smoke:codex    # Apply doit transférer un fichier sentinelle
npm run sandcastle:smoke:cursor   # Reject doit garder le workspace principal intact
```

---

## 4. Rapport technique des changements

### 4.1 Nouvelle couche `src/sandcastle/` (cœur du POC)

| Fichier | Rôle |
|---------|------|
| `bridge.ts` | Point d'entrée du processus bridge : stdio NDJSON ACP, redirige `console.log` vers stderr |
| `SandcastleAcpAgent.ts` | Implémente l'interface `Agent` ACP : `initialize`, `newSession`, `prompt`, `cancel`, `closeSession`, méthodes d'extension |
| `DefaultSandcastleRuntime.ts` | Branche vers `@ai-hero/sandcastle` : `createSandbox`, providers `codex()` / `cursor()`, sandbox `docker()` |
| `BridgeConfig.ts` | Parse `--provider`, `--model`, `--effort` ; image via `ACP_SANDCASTLE_IMAGE` |
| `PromptHistory.ts` | Reconstruction d'historique borné (16 msgs / 64 KiB) |
| `ProviderRunError.ts` | Enrichit les erreurs provider (quota, auth, etc.) en `RequestError` ACP |
| `SandcastlePromotionUi.ts` | UI VS Code : preview, diff, apply, reject via `extMethod` |

**Méthodes d'extension ACP** exposées par le bridge :

| Méthode | Description |
|---------|-------------|
| `sandcastle/status` | État session / sandbox |
| `sandcastle/preview` | Diff binaire + nombre de fichiers |
| `sandcastle/apply` | Promotion vers le workspace principal |
| `sandcastle/reject` | Nettoyage sans promotion |

### 4.2 Build (`webpack.config.js`)

Deuxième bundle webpack :

- entrée : `src/sandcastle/bridge.ts`
- sortie : `dist/sandcastle-acp-bridge.js`
- bundlé séparément de `extension.js` (processus enfant autonome)

### 4.3 Configuration agents (`AgentConfig.ts`)

Union de types :

```json
// Legacy — inchangé
{ "command": "...", "args": [], "env": {}, "transport": "acp" }

// Nouveau
{
  "transport": "sandcastle",
  "provider": "codex",
  "model": "gpt-5.4",
  "effort": "high",
  "env": {}
}
```

Helper `isSandcastleAgentConfig()` utilisé partout pour brancher le comportement.

### 4.4 Lancement (`AgentManager.ts`)

Si `transport === 'sandcastle'`, l'extension lance :

```text
node dist/sandcastle-acp-bridge.js --provider <codex|cursor> --model <model> [--effort <level>]
```

Au lieu de `npx <agent-acp>`. Variable `ELECTRON_RUN_AS_NODE=1` pour réutiliser le Node embarqué dans VS Code.

### 4.5 Commandes VS Code

| Commande | Titre |
|----------|-------|
| `acp.sandcastle.showDiff` | ACP: Sandcastle Show Diff |
| `acp.sandcastle.apply` | ACP: Sandcastle Apply Changes |
| `acp.sandcastle.reject` | ACP: Sandcastle Reject Changes |

Helper `resolveActiveSandcastle()` dans `RegisterCommands.ts` : vérifie qu'une session active utilise bien un agent Sandcastle.

### 4.6 Pipeline (`AcpAgentRunner.ts`)

Après un run éphémère (pipeline/inline) avec un agent Sandcastle sur une primitive `sideEffects: workspace` → `SandcastlePromotionUi.promote()` avant de tuer le processus bridge. Les steps read-only appellent `discard()` silencieusement.

### 4.7 Erreurs (`AgentError.ts`, `ChatWebviewController.ts`)

- `formatAgentErrorMessage()` — préfère les `details` ACP aux messages génériques « Internal error »
- `classifyAgentError()` — nouveaux kinds `provider-quota`, `provider-auth`
- Le chat concatène le hint d'action pour ces deux cas

### 4.8 Infrastructure `.sandcastle/`

| Fichier | Rôle |
|---------|------|
| `Dockerfile` | Image Node 22 + git + Codex CLI + Cursor Agent CLI, user non-root `agent` |
| `.env.example` | Template clés API |
| `.gitignore` | Ignore `.env`, logs, state runtime |

`DefaultSandcastleRuntime` monte `.sandcastle/codex-home/` en écriture dans le conteneur (copie initiale de `~/.codex/auth.json` si présent).

### 4.9 Scripts

| Script | Rôle |
|--------|------|
| `scripts/sandcastle-smoke.mjs` | Test E2E headless : session → prompt → sentinel file → apply/reject → vérif workspace |

### 4.10 Dépendances

- `@ai-hero/sandcastle@0.6.4` (nouvelle dépendance principale)
- Transitives Docker dans `package-lock.json`

### 4.11 Tests unitaires (nouveaux)

- `src/test/sandcastle/BridgeConfig.test.ts`
- `src/test/sandcastle/DefaultSandcastleRuntime.test.ts`
- `src/test/sandcastle/PromptHistory.test.ts`
- `src/test/sandcastle/ProviderRunError.test.ts`
- `src/test/sandcastle/SandcastleAcpAgent.test.ts`
- `src/test/core/AgentError.test.ts` (enrichi)

### 4.12 Documentation

- `docs/adr/0013-acp-sandcastle-bridge.md` — décision architecture
- `docs/adr/0014-sandcastle-bounded-prompt-history.md` — historique borné côté bridge
- `docs/sandcastle-architecture.md` — flux et config
- `docs/sandcastle-first-test.md` — guide de test manuel
- ADR-0011 marqué **superseded** (sandbox legacy retiré)

---

## 5. Limitations connues

| Limitation | Impact |
|------------|--------|
| **POC seulement Codex + Cursor** | Les autres agents restent sur l'hôte |
| **Pas de resume natif** | Historique reconstruit manuellement, borné |
| **Réseau Docker non filtré** | Accès sortant libre (API OpenAI/Cursor) — pas d'allowlist egress |
| **Texte uniquement** | Pas d'images/audio dans les prompts Sandcastle |
| **Un prompt à la fois** | Erreur si double prompt sur la même session |
| **Sandbox legacy** | Retiré — utiliser Sandcastle pour l'isolation |
| **Docker obligatoire** | Friction setup (build image, UID/GID, clés API) |
| **Windows non testé** | Le bridge Sandcastle utilise `process.execPath` ; le spawn shell Unix des agents natifs reste inchangé |

---

## 6. Checklist avant merge

- [ ] Docker installé et daemon actif
- [ ] Image buildée :
  ```bash
  docker build \
    --build-arg AGENT_UID="$(id -u)" \
    --build-arg AGENT_GID="$(id -g)" \
    -t acp-client-sandcastle:local \
    -f .sandcastle/Dockerfile .
  ```
- [ ] `.sandcastle/.env` rempli (non commité)
- [ ] `npm run compile` OK
- [ ] `npm test` OK
- [ ] `npm run sandcastle:smoke:codex` OK
- [ ] `npm run sandcastle:smoke:cursor` OK
- [ ] Test manuel F5 : connecter « Codex Sandcastle », modifier un fichier, Show Diff → Apply/Reject
- [ ] Vérifier qu'un agent ACP natif (ex. Claude Code) fonctionne toujours normalement

---

## 7. Verdict merge

**Merge recommandé si** tu veux le POC Sandcastle avec isolation Docker + promotion explicite, sans casser les agents existants.

**Attendre ou merger sur une branche dédiée si** :

- tu n'as pas Docker dans ton workflow quotidien,
- les smoke tests ne passent pas encore chez toi,
- tu veux éviter la dépendance `@ai-hero/sandcastle` tant que le POC n'est pas validé en conditions réelles.

Le sandbox worktree-only (ADR-0011) a été retiré ; Sandcastle est le seul chemin d'isolation avec promotion.
