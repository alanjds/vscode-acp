# ACP Client pour VS Code

[English](README.md)

Extension [Visual Studio Code](https://marketplace.visualstudio.com/items?itemName=damien-huyet.acp-client) qui connecte l’éditeur à tout agent de code compatible [Agent Client Protocol (ACP)](https://agentclientprotocol.com/) — CLIs natives sur l’hôte, ou exécutions Codex/Cursor isolées dans Docker via Sandcastle.

> [!NOTE]
> Fork de [vscode-acp](https://github.com/formulahendry/vscode-acp) par [formulahendry](https://github.com/formulahendry), étendu avec pipelines, équipes d’agents, isolation Sandcastle et historique de sessions par workspace.

![Capture d’écran ACP Client](resources/screenshot.png)

## Démarrage rapide

1. Installer depuis le [Marketplace](https://marketplace.visualstudio.com/items?itemName=damien-huyet.acp-client) | [Ouvrir dans VS Code](https://vscode.dev/redirect?url=vscode%3Aextension%2Fdamien-huyet.acp-client) | [Open VSX](https://open-vsx.org/extension/damien-huyet/acp-client)
2. Ouvrir la barre d’activité **ACP Client** (icône ACP)
3. Dans **Agents**, cliquer sur **+** pour ajouter une configuration ou choisir un agent par défaut
4. Se connecter à un agent, puis discuter dans le panneau **Chat**

Pour les agents Sandcastle (Codex/Cursor dans Docker), compléter d’abord la [configuration Sandcastle](#agents-sandcastle-docker).

## Prérequis

| Composant | Nécessaire pour |
|-----------|-----------------|
| **Node.js 18+** | Lancer les processus agents ACP natifs |
| **Agent compatible ACP** | Sur le `PATH` ou via `npx` (voir [agents préconfigurés](#agents-préconfigurés)) |
| **Docker** | Agents Sandcastle Codex et Cursor uniquement |
| **Dépôt Git** | Worktrees Sandcastle |

---

## Vue d’ensemble des fonctionnalités

### Chat et sessions

- **Chat interactif** — rendu Markdown, texte assistant en streaming, appels d’outils repliables, blocs de réflexion avec durée
- **Un seul agent actif** — un agent connecté à la fois ; changer d’agent depuis l’arbre
- **Arbre des sessions** — développer chaque agent pour parcourir les sessions passées ; cliquer pour ouvrir ou reprendre
- **Capacités de session** — utilise `session/list`, `session/load` et `session/resume` natifs de l’agent quand disponibles ; sinon **cache local par workspace**
- **Options de configuration de session** — sélecteurs dynamiques dans la barre d’outils (mode, modèle, niveau de raisonnement, …) fournis par l’agent
- **Commandes slash** — autocomplétion des commandes de l’agent
- **Mentions de fichiers** — taper `@` dans le compositeur pour attacher des chemins du workspace
- **Persistance du chat** — l’état de la conversation survit aux changements de panneau ; chat dans la barre latérale ou l’éditeur

### Contexte et intégration éditeur

- **Lien de contexte éditeur** (opt-in) — injecter fichier courant, curseur, sélection, langage et éditeurs ouverts dans les prompts
- **Transfert de contexte** — passer explicitement la discussion en cours à un autre agent ou une autre session (injection unique sur le prochain prompt)
- **Familles de contexte** — sessions liées dans l’arbre quand le contexte est partagé
- **Système de fichiers et terminal** — les agents lisent/écrivent les fichiers et exécutent des commandes via les handlers ACP
- **Permissions** — approbation automatique configurable (`ask` ou `allowAll`)

### Orchestration

- **Pipelines LangGraph** — moteur d’orchestration : agents virtuels depuis `.acp/pipelines/*.yaml` (portes d’approbation, étapes personnalisées, branches parallèles)
- **Équipes d’agents** — raccourci déclaratif au-dessus des pipelines : `.acp/teams/*.yaml` compile en pipeline v2 à l’exécution (`planner` → approbation → `implementer` → `reviewer` → `tester` optionnel)

### Runtimes d’isolation

Deux façons pour les agents d’interagir avec le workspace :

| Runtime | Agents | Où ça tourne | Promotion |
|---------|--------|--------------|-----------|
| **ACP natif** | Claude, Vibe, Codex CLI, … | Processus hôte | Écritures directes dans le workspace (défaut) |
| **Sandcastle** | Codex Sandcastle, Cursor Sandcastle | Docker + worktree git | commandes **Apply** / **Reject** |

Voir [ACP natif vs Sandcastle](#acp-natif-vs-sandcastle-docker).

### Outils développeur

- **Trafic protocole** — journal JSON-RPC ACP complet dans le canal ACP Traffic
- **Instantanés debug** — panneau de traces en mémoire (voir, copier, exporter)
- **Registre d’agents** — parcourir les agents ACP découvrables
- **Chat inline** (expérimental) — invite dans l’éditeur via l’API proposée `editorInsets` ; Insiders recommandé pour l’UX complète

---

## ACP natif vs Sandcastle (Docker)

L’interface de chat est identique. Ce qui change : **où l’agent tourne**, **comment la mémoire fonctionne**, et **comment les modifications atteignent le workspace**.

### Comparaison

| | **ACP natif** | **Sandcastle** |
|---|---------------|----------------|
| **Transport** | `transport: "acp"` (défaut) | `transport: "sandcastle"` |
| **Processus** | `npx` / CLI local sur la machine | CLI Codex ou Cursor dans Docker |
| **Système de fichiers** | Écrit directement dans le workspace | Worktree git isolé jusqu’à la promotion |
| **Mémoire de conversation** | L’agent garde l’état via `sessionId` ; chargement/reprise si supporté | Le bridge reconstruit un **transcript texte borné** (8 tours, 64 KiB) — [ADR-0014](docs/adr/0014-sandcastle-bounded-prompt-history.md) |
| **Liste / reprise de session** | Oui, si l’agent le supporte | Pas de reprise native du fournisseur dans Sandcastle 0.6.4 |
| **Idéal pour** | Fils longs, reprise de sessions, fonctionnalités complètes du fournisseur | **Runs frais**, spikes sûrs, expérimentations sans toucher l’arbre principal |

Même fournisseur, deux modes :

| Entrée dans les paramètres | Ce que vous obtenez |
|----------------------------|---------------------|
| **Codex CLI** | ACP natif sur l’hôte |
| **Codex Sandcastle** | Codex dans Docker avec Apply/Reject explicites |
| **Cursor CLI** | ACP natif sur l’hôte (`agent acp`) |
| **Cursor Sandcastle** | Cursor dans Docker avec Apply/Reject explicites |

### Travailler avec des agents « frais »

Un agent **frais** démarre sans bagage des tours précédents, bruit d’outils ou modifications à moitié faites.

Les sessions **ACP natives** sont longues : le processus accumule le contexte et peut reprendre des sessions passées. Utiliser **Nouvelle conversation** pour repartir proprement sans Docker.

**Sandcastle** pousse l’isolation plus loin :

1. **Système de fichiers** — les modifications restent dans un worktree jetable (`sandcastle/acp/<provider>/<uuid>`) jusqu’à promotion.
2. **Run fournisseur** — chaque prompt est un nouveau `sandbox.run()` ; seuls les derniers tours sont injectés en texte brut.
3. **Reset explicite** — **Apply** ou **Reject** démonte le sandbox et efface l’historique côté bridge.
4. **Nouvelle session** — une nouvelle session ACP obtient une nouvelle branche et un nouveau contexte conteneur.

| Objectif | Approche |
|----------|----------|
| Tester un changement risqué en sécurité | Sandcastle → prompt → Show Diff → Apply ou Reject |
| Reset complet filesystem + contexte fournisseur | **Reject** (ou Apply si terminé), puis **Nouvelle conversation** |
| Comparer deux implémentations | Deux sessions Sandcastle, ou Reject entre les tentatives |
| Investigation sur plusieurs jours avec mémoire complète | Agent natif avec reprise de session |
| Étape pipeline qui ne doit pas toucher `main` | Utiliser un agent **Sandcastle** comme implementer dans l’équipe |

### Workflow Sandcastle (usage quotidien)

1. Se connecter à **Codex Sandcastle** ou **Cursor Sandcastle**
2. Envoyer un prompt ciblé (un objectif clair par run — le contexte est plafonné)
3. Revoir : **ACP: Sandcastle Show Diff**
4. Promouvoir : **ACP: Sandcastle Apply Changes** ou **ACP: Sandcastle Reject Changes**
5. Pour la prochaine tâche isolée, repartir avec Reject ou **Nouvelle conversation**

En fin de run **pipeline**, la promotion peut s’ouvrir automatiquement selon `acp.sandcastle.promotion` (`ask`, `autoApply`, `autoReject`). Voir [Promotion Apply/Reject (changements en cours)](doc_fr/changements-sandcastle-promotion-en-cours.md).

---

## Agents préconfigurés

### Sandcastle (Docker)

| Agent | Runtime |
|-------|---------|
| Codex Sandcastle | Docker + `codex("gpt-5.4")` |
| Cursor Sandcastle | Docker + `cursor("composer-2")` |

### ACP natif (hôte)

| Agent | Commande |
|-------|----------|
| GitHub Copilot | `npx @github/copilot-language-server@latest --acp` |
| Claude Code | `npx @agentclientprotocol/claude-agent-acp@latest` |
| Gemini CLI | `npx @google/gemini-cli@latest --experimental-acp` |
| Qwen Code | `npx @qwen-code/qwen-code@latest --acp --experimental-skills` |
| Auggie CLI | `npx @augmentcode/auggie@latest --acp` |
| Qoder CLI | `npx @qoder-ai/qodercli@latest --acp` |
| Codex CLI | `npx @zed-industries/codex-acp@latest` |
| Cursor CLI | `agent acp` |
| Vibe | `vibe-acp` |
| OpenCode | `npx opencode-ai@latest acp` |
| OpenClaw | `npx openclaw acp` |
| [Kiro CLI](https://kiro.dev/docs/cli/acp/) | `kiro-cli acp` |
| [Hermes Agent](https://hermes-agent.nousresearch.com/docs/user-guide/features/acp) | `hermes acp` |
| [Pi Agent](https://github.com/svkozak/pi-acp) | `npx -y pi-acp` |

Ajouter des entrées personnalisées sous `acp.agents` dans les paramètres. Chaque entrée est soit :

```json
{ "command": "npx", "args": ["@agentclientprotocol/claude-agent-acp@latest"], "env": {}, "transport": "acp" }
```

soit Sandcastle :

```json
{ "transport": "sandcastle", "provider": "codex", "model": "gpt-5.4", "effort": "high", "env": {} }
```

> **Hermes** est un paquet Python — installer via le [quickstart Hermes](https://hermes-agent.nousresearch.com/docs/getting-started/quickstart) (Linux/macOS/WSL2). Mettre `hermes` sur le `PATH` et lancer VS Code depuis le même shell.

> **Vibe** doit être installé séparément ; `vibe-acp` doit être sur le `PATH`.

---

## Agents Sandcastle (Docker)

### Configuration initiale

```bash
cp .sandcastle/.env.example .sandcastle/.env
# Renseigner OPENAI_API_KEY et CURSOR_API_KEY (gitignored)

docker build \
  --build-arg AGENT_UID="$(id -u)" \
  --build-arg AGENT_GID="$(id -g)" \
  -t acp-client-sandcastle:local \
  -f .sandcastle/Dockerfile .
```

Vérifier les CLIs dans l’image :

```bash
docker run --rm --entrypoint sh acp-client-sandcastle:local \
  -lc 'id && codex --version && cursor-agent --version'
```

### Tests de fumée

```bash
npm run sandcastle:smoke:codex    # Apply transfère un fichier sentinelle
npm run sandcastle:smoke:cursor   # Reject garde le workspace principal propre
```

### Limites (POC)

- Prompts texte uniquement (pas d’images/audio)
- Un prompt à la fois par session
- L’historique du bridge est volatile (perdu au redémarrage ou après Apply/Reject)
- Réseau sortant Docker non restreint (accès API requis)
- Windows non testé pour le bridge Sandcastle

Docs : [architecture](docs/sandcastle-architecture.md) · [guide premier test](docs/sandcastle-first-test.md) · [ADR-0013](docs/adr/0013-acp-sandcastle-bridge.md) · [ADR-0014](docs/adr/0014-sandcastle-bounded-prompt-history.md)

Changelog français : [docs/sandcastle-changelog-fr.md](docs/sandcastle-changelog-fr.md)

---

## Pipelines et équipes d’agents

Les pipelines et les équipes d’agents ne sont **pas deux systèmes concurrents**. Les équipes sont un DSL simplifié qui compile dans le même moteur pipeline v2 exécuté par LangGraph.

```text
Équipes d’agents (.acp/teams/*.yaml)
        │  compilation à l’exécution (AgentTeamCompiler)
        ▼
Pipeline v2 (.acp/pipelines/*.yaml)
        │  graphe LangGraph
        ▼
Agents ACP (Codex CLI, Vibe, Cursor CLI, …)
```

| | **Pipelines** | **Équipes d’agents** |
|---|---------------|----------------------|
| **Rôle** | Moteur d’orchestration | Couche déclarative au-dessus |
| **Quand l’utiliser** | Workflows custom : branches parallèles, ordre d’étapes non standard, primitives métier | Plan → approbation → implémentation → revue (et test optionnel) |
| **Prompts** | Inline dans le YAML (`primitives.*.prompt`) | Fichiers Markdown externes (`.acp/agents/*.md`) |
| **Flexibilité** | DSL v2 complet | Ordre des rôles fixe en v1 |

**Garder les deux fonctionnalités** dans le produit : les pipelines sont le moteur ; les équipes sont le sucre ergonomique pour le cas courant.

**Éviter les configs workspace en double** : si vous avez déjà `.acp/teams/feature-team.yaml`, vous n’avez généralement pas besoin d’un pipeline `plan-execute-verify` écrit à la main avec le même flux. Utiliser les pipelines bruts pour les workflows avancés (voir `.acp/pipelines/save/` pour des exemples comme la revue parallèle).

### Pipelines (`.acp/pipelines/*.yaml`)

Quand `acp.pipeline.enabled` est à `true`, chaque pipeline valide apparaît comme agent virtuel dans l’arbre.

1. Se connecter à l’agent pipeline
2. Envoyer un prompt — LangGraph exécute le workflow
3. Relire ou modifier le plan à l’étape d’approbation (**gate humaine obligatoire**, même si l’implementer est Sandcastle ou si `acp.sandcastle.promotion` vaut `autoApply`)
4. Approuver pour continuer, ou rejeter pour arrêter
5. Les étapes suivantes invoquent les agents ACP configurés ; la promotion Sandcastle (Apply/Reject) intervient **après** l’implementer, pas avant l’approbation du plan

Voir [doc_fr/pipelines-langgraph.md](doc_fr/pipelines-langgraph.md) · English: [docs/pipeline-a2a.md](docs/pipeline-a2a.md)

### Équipes d’agents (`.acp/teams/*.yaml`)

Workflows déclaratifs plan → implémentation → revue sans écrire le YAML pipeline à la main.

```yaml
version: 1
id: feature-team
title: Feature Team
roles:
  planner:
    agent: Codex CLI
    instructions: .acp/agents/planner.md
  implementer:
    agent: Vibe
    instructions: .acp/agents/implementer.md
  reviewer:
    agent: Claude Code
    instructions: .acp/agents/reviewer.md
```

À l’exécution, une équipe comme `feature-team` devient un pipeline avec les étapes `planner → approval → implementer → reviewer` (et `tester` si défini). Inspecter le résultat avec **ACP: Show Compiled Team Pipeline**.

Voir [doc_fr/agent-teams.md](doc_fr/agent-teams.md) · English: [docs/agent-teams.md](docs/agent-teams.md)

---

## Paramètres

| Paramètre | Défaut | Description |
|-----------|--------|-------------|
| `acp.agents` | natifs + 2 Sandcastle | Configs agents (`transport: "acp"` ou `"sandcastle"`) |
| `acp.autoApprovePermissions` | `ask` | Demandes de permission : `ask` ou `allowAll` |
| `acp.defaultWorkingDirectory` | `""` | Répertoire de travail de session ; vide = racine du workspace |
| `acp.logTraffic` | `true` | Journaliser le JSON-RPC ACP dans le canal ACP Traffic |
| `acp.pipeline.enabled` | `true` | Charger `.acp/pipelines/` et `.acp/teams/` |
| `acp.instructions.maxBytes` | `262144` | Taille max des fichiers Markdown d’instructions d’équipe |

---

## Commandes

### Connexion et chat

| Commande | Description |
|----------|-------------|
| `ACP: Connect to Agent` | Se connecter à un agent configuré |
| `ACP: Connect With Current Context` | Se connecter et transférer la discussion en cours (unique) |
| `ACP: Open Session With Current Context` | Ouvrir/reprendre une session avec contexte en attente |
| `ACP: New Conversation` | Nouvelle session avec l’agent connecté |
| `ACP: Send Prompt` | Envoyer un message |
| `ACP: Cancel Current Turn` | Annuler le tour en cours |
| `ACP: Disconnect Agent` | Se déconnecter |
| `ACP: Restart Agent` | Redémarrer le processus agent |
| `ACP: Open Chat Panel` | Focus sur le chat latéral |
| `ACP: Open Chat in Editor` | Ouvrir le chat en onglet éditeur |
| `ACP: Move Chat to Editor` | Déplacer le chat latéral vers l’éditeur |

### Arbre des sessions

| Commande | Description |
|----------|-------------|
| `ACP: Refresh Sessions` | Recharger la liste des sessions d’un agent |
| `ACP: Open Session` | Charger ou reprendre une session sélectionnée |
| `ACP: Load More Sessions` | Paginer la liste des sessions |
| `ACP: Forget Session` | Supprimer l’enregistrement local de session |
| `Copy Session ID` | Copier l’ID de session dans le presse-papiers |

### Sandcastle

| Commande | Description |
|----------|-------------|
| `ACP: Sandcastle Show Diff` | Prévisualiser le patch du worktree |
| `ACP: Sandcastle Apply Changes` | Appliquer le patch au workspace principal |
| `ACP: Sandcastle Reject Changes` | Abandonner les modifications du worktree |

### Pipelines et équipes

| Commande | Description |
|----------|-------------|
| `ACP: Enable / Disable Pipeline Agents` | Activer/désactiver `acp.pipeline.enabled` |
| `ACP: Show Compiled Team Pipeline` | Inspecter le JSON pipeline v2 généré |
| `ACP: Re-run Team Reviewer` | Relancer le reviewer sur la dernière sortie d’équipe |

### Configuration et debug

| Commande | Description |
|----------|-------------|
| `ACP: Add / Remove Agent Configuration` | Gérer `acp.agents` |
| `ACP: Set Agent Mode` / `Set Agent Model` | Sélecteurs legacy dans la barre d’outils |
| `ACP: Enable / Disable Editor Context Link` | Activer/désactiver l’injection de contexte éditeur |
| `ACP: Show Log` | Canal de log de l’extension |
| `ACP: Show Protocol Traffic` | Canal trafic ACP |
| `ACP: Open Debug Snapshot` | Panneau d’instantanés debug |
| `ACP: Browse Agent Registry` | Navigateur du registre d’agents |
| `Damien: Inline Chat` | Inset éditeur expérimental (Insiders) |

### Raccourcis clavier

| Raccourci | Action |
|-----------|--------|
| `Ctrl+Shift+A` (`Cmd+Shift+A` sur Mac) | Ouvrir le panneau chat |
| `Échap` (tour en cours) | Annuler le tour en cours |

---

## Développement

### Prérequis

- Node.js 18+
- VS Code 1.85+

### Installation

```bash
git clone https://github.com/maurice30120/vscode-acp.git
cd vscode-acp
npm install
```

### Build et tests

```bash
npm run compile       # Build unique
npm run watch         # Mode watch
npm test              # Tests unitaires (pretest + lint d’abord)
npm run package       # Bundle de production
```

Appuyer sur **F5** pour lancer l’Extension Development Host.

Packager un `.vsix` :

```bash
npx @vscode/vsce package
```

### Architecture

```text
Extension (VS Code)
  ├── SessionManager / ConnectionManager / AgentManager
  ├── Chat webview (React)
  ├── PipelineService + AgentTeamCompiler (LangGraph)
  └── Processus bridge Sandcastle (stdio ACP → Docker)
        └── @ai-hero/sandcastle → CLI Codex / Cursor
```

Modules clés : `src/core/`, `src/ui/`, `src/pipeline/`, `src/sandcastle/`, `webview/`.

La communication avec les agents utilise ACP (JSON-RPC 2.0 sur stdio).

---

## Documentation

| Sujet | Français | English |
|-------|----------|---------|
| README | [README.fr.md](README.fr.md) | [README.md](README.md) |
| Pipelines | [doc_fr/pipelines-langgraph.md](doc_fr/pipelines-langgraph.md) | [docs/pipeline-a2a.md](docs/pipeline-a2a.md) |
| Équipes d’agents | [doc_fr/agent-teams.md](doc_fr/agent-teams.md) | [docs/agent-teams.md](docs/agent-teams.md) |
| Sandcastle | [docs/sandcastle-changelog-fr.md](docs/sandcastle-changelog-fr.md) | [docs/sandcastle-architecture.md](docs/sandcastle-architecture.md) |
| Promotion Apply/Reject (changements en cours) | [doc_fr/changements-sandcastle-promotion-en-cours.md](doc_fr/changements-sandcastle-promotion-en-cours.md) | — |
| ADR | [doc_fr/adr/](doc_fr/adr/) | [docs/adr/](docs/adr/) |

---

## Problèmes connus

- Les agents doivent être sur le `PATH` ou accessibles via `npx`
- Certains agents nécessitent une authentification séparée
- Les rôles pipeline et équipe référencent les agents par nom — tous doivent exister dans `acp.agents`
- Sandcastle nécessite Docker, la construction de l’image et les clés dans `.sandcastle/.env`
- Le chat inline nécessite VS Code Insiders + API proposée pour l’UX complète entre les lignes
- Bridge Sandcastle : Windows non testé ; macOS/Linux nécessitent `AGENT_UID`/`AGENT_GID` à la construction de l’image

---

## Liens

- [Marketplace](https://marketplace.visualstudio.com/items?itemName=damien-huyet.acp-client)
- [Agent Client Protocol](https://agentclientprotocol.com/)
- [Dépôt GitHub](https://github.com/maurice30120/vscode-acp)

## Divers

- [Un poème sur le code](doc_fr/poeme-sur-le-code.md)

## Licence

MIT — voir [LICENSE](LICENSE).
