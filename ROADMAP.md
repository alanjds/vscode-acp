# Roadmap ACP Client

Cette roadmap regroupe l'état d'avancement, les idées d'évolution et les possibilités pour ACP Client, une extension VS Code permettant de connecter l'éditeur à des agents compatibles avec l'Agent Client Protocol.

## Objectifs du Projet

- Offrir une interface VS Code fiable pour discuter avec des agents ACP depuis le workspace courant.
- Faciliter le passage d'un agent à un autre tout en conservant les sessions, l'historique et les options propres à chaque agent.
- Rendre les workflows agentiques plus sûrs grâce à une gestion claire des permissions, du contexte envoyé et des actions terminal/fichier.
- Explorer des scénarios multi-agents, notamment la séparation entre planification et implémentation.

---

## Réalisé

### Chat, sessions et contexte

- Chat interactif : Markdown, streaming assistant, outils repliables, blocs de réflexion.
- Arbre des sessions par agent ; reprise via `session/list`, `session/load`, `session/resume` quand l'agent le supporte, sinon cache local par workspace.
- Options de session dynamiques (modèle, mode, niveau de raisonnement, …).
- Mentions de fichiers (`@`), commandes slash, persistance du chat (barre latérale ou éditeur).
- Contexte éditeur opt-in (fichier, curseur, sélection, langage, éditeurs ouverts).
- Transfert de contexte entre agents/sessions ; familles de contexte dans l'arbre.
- Permissions configurables (`ask` / `allowAll`) via `PermissionHandler`.

### Orchestration multi-agents

- Pipelines LangGraph v2 déclaratifs (`.acp/pipelines/*.yaml`) exposés comme agents virtuels.
- Équipes d'agents (`.acp/teams/*.yaml`) compilées en pipeline v2 à l'exécution (planner → approbation → implementer → reviewer → tester).
- Pipeline `plan-execute-verify` et catalogue d'exemples dans `.acp/pipelines/save/`.
- Instructions partagées par rôle via `InstructionResolver` et fichiers `.acp/agents/*.md`.
- Runs éphémères (`EphemeralRun`, `EphemeralSandcastleRun`) pour les étapes pipeline et l'inline chat.
- Bloc UI d'approbation de plan (`PipelinePlanBlock`) dans la webview.

### Skills workspace (base livrée)

- Catalogue `.agents/skills/**/SKILL.md` : frontmatter, `disable-model-invocation`, cache par mtime.
- Injection du catalogue au premier prompt (`<available_skills>`) ; expansion `/skill-name` vers le contenu complet.
- Settings `acp.skills.*` ; désactivation par agent (`skills: false` dans la config).
- Agents ciblés par défaut : Cursor CLI, Codex Sandcastle, Cursor Sandcastle.
- Symlink `.cursor/skills` → `.agents/skills` pour Cursor CLI (`SkillsWorkspacePrep`).
- Mount `.agents` dans le conteneur Sandcastle (`SandboxMounts`) pour lecture des skills en isolation.
- Branchement dans `SessionManager` (chat persistant) et `EphemeralRun` (pipeline / inline).
- Tests unitaires : `SkillsCatalog`, `SkillsPromptBuilder`, `SkillsWorkspacePrep`.

### Sandcastle (ex-sandbox v1)

- Agents **Codex Sandcastle** et **Cursor Sandcastle** : Docker + worktree git isolé.
- Bridge ACP (`transport: "sandcastle"`) ; historique de conversation borné côté bridge (ADR-0014).
- Promotion **Apply** / **Reject** ; UI QuickPick et modes `ask` / `autoApply` / `autoReject`.
- Erreurs provider enrichies (quota, authentification).
- Documentation : `docs/sandcastle-architecture.md`, `docs/sandcastle-first-test.md`, ADR-0013/0014.
- Tests automatisés Sandcastle (bridge, promotion, runs éphémères, historique prompt).

### Outils développeur et qualité

- Trafic protocole ACP (canal ACP Traffic).
- Instantanés debug en mémoire (voir, copier, exporter) — ADR-0008.
- Registre d'agents ACP découvrables.
- Chat inline expérimental (API `editorInsets`).
- Erreurs agent classifiées (`AgentError` : command-not-found, auth, quota, handshake, …).
- Runtime extension modulaire + sessions virtuelles pour pipelines/équipes (ADR-0015).
- ~40 fichiers de tests couvrant sessions, pipelines, sandcastle, permissions, webview, etc.

### Architecture et documentation

- `extension.ts` allégé → `ExtensionRuntime` + `RuntimeResources` (rollback à l'activation).
- Plugins optionnels : `OrchestrationPlugin`, `SandcastlePlugin`, `InlineChatPlugin` via `FeaturePluginRegistry`.
- Seam transport : ACP natif / virtual (`VirtualSessionRuntime`) / Sandcastle — ADR-0015.
- `OrchestrationRuntime` découplé de `SessionManager` ; webview extensible via `registerFeatureMessageHandler`.
- `SandcastlePromotion` centralise Apply/Reject ; commandes dans le plugin Sandcastle.
- Carte des contextes (`CONTEXT-MAP.md`) + glossaires par domaine (`src/*/CONTEXT.md`).
- 15 ADR couvrant sessions, pipelines, Sandcastle, debug, inline chat, runtime.
- Diagnostic de dispersion documenté (vocabulaire session, frontières Discussion/ChatHistory/BridgeTranscript).

---

## En Cours — Court Terme

- **Sandcastle** : base livrée ; reste à renforcer (garde-fous terminal/réseau, limites dans l'UI, isolation OS optionnelle) et à valider en conditions réelles.
- Stabiliser la liste des sessions et les mécanismes de reprise selon les capacités réellement exposées par chaque agent.
- Améliorer le contexte VS Code envoyé aux agents : contrôles plus visibles et meilleure prévisibilité.
- Renforcer les messages d'erreur autour du lancement des agents, de l'authentification et des commandes introuvables (base `AgentError` en place, à étendre).
- Documenter plus clairement les agents préconfigurés, leurs prérequis et leurs limites.

### Architecture et nettoyage (en cours)

Travail amorcé avec ADR-0015 et `CONTEXT-MAP.md` ; à poursuivre sans bloquer les features.

**Modules à approfondir** (interfaces plus petites, implémentations plus localisées) :

- `SessionManager` (~1100 lignes) — clarifier load vs resume, réduire les branches transport.
- `PipelineService` (~750 lignes) — extraire compilation, exécution et persistance des étapes.
- `ChatWebviewController` (~700 lignes) — isoler l'état pipeline de l'état chat générique.
- `RegisterCommands` / `SessionTreeProvider` — scinder par domaine (session, sandcastle, debug).

**Dette documentée à traiter** (voir `CONTEXT-MAP.md`, section diagnostic) :

- Vocabulaire « session » surchargé — imposer les termes canoniques (ProtocolSession, Conversation, SessionRecord, BridgeConversation).
- Écart resume vs load : `ChatHistory` pas toujours réinitialisée au resume.
- `EphemeralRun` duplique le cycle spawn/connect hors `ConnectedAgent` — consolidation structurelle future.
- Fuite domaine Pipeline → état webview partagé (timeline pipeline dans l'état chat générique).
- Alignement `docs/` (EN) et `doc_fr/` — pas de synchronisation automatique aujourd'hui.

**Seams et runtime** :

- Slot unique `VirtualSessionRuntime` — prévoir registre multi-transports si un second runtime virtual apparaît (inline-only, comparaison, …).
- Réduire l'indirection webview → plugin → runtime → `SessionManager` → runtime (traçabilité, tests ciblés).
- ADR pour chaque nouvelle frontière majeure ; tenir les `CONTEXT.md` à jour avec le code.

**Nettoyage ciblé** :

- Retirer ou archiver le code legacy sandbox pré-Sandcastle (ADR-0011) une fois Sandcastle validé.
- Factoriser les chemins Sandcastle natif / éphémère / pipeline derrière des adapters testables.
- Harmoniser les patterns d'erreur et de cancellation (`RunAbortedError`, `AbortSignal`) sur tous les transports.

### Skills workspace (à renforcer)

Base fonctionnelle en place ; l'expérience reste surtout invisible et limitée à quelques agents.

**UX et découverte** :

- Autocomplétion `/skill` dans le compositeur (comme les mentions `@`).
- Panneau ou liste des skills du workspace (nom, description, chemin, état).
- Afficher dans l'UI quels skills seront injectés / ont été utilisés sur la session.

**Robustesse** :

- Watcher sur `.agents/skills` (aujourd'hui cache invalidé seulement au mtime de la racine).
- Validation des `SKILL.md` (frontmatter manquant, doublons de noms) avec erreurs visibles dans le log ACP.
- Stratégie claire pour `EphemeralRun` : éviter de réinjecter le catalogue complet à chaque étape pipeline si inutile.

**Couverture agents et orchestration** :

- Étendre ou documenter le support pour les agents ACP natifs (Claude, Vibe, Gemini, Codex CLI, …).
- Skills par rôle dans les équipes / pipelines (ex. `tester` → skill TDD).
- Rapprocher skills et `InstructionResolver` : format partageable, pas de duplication instructions vs skills.
- Vérifier le parcours inline chat et Sandcastle multi-tours (lecture skill dans le conteneur + invocation `/skill`).

**Documentation** :

- Guide dédié `docs/skills.md` (format, settings, agents supportés, limites Sandcastle).
- Glossaire `src/skills/CONTEXT.md` aligné sur `CONTEXT-MAP.md`.

---

## Moyen Terme

- Profils d'agents déclaratifs en YAML (`.acp/agents/*.yaml`) — aujourd'hui seuls les fichiers `.md` d'instructions existent pour les équipes.
- Recherche dans l'historique des sessions (agent, date, titre, contenu).
- Export et import de sessions.
- Pipeline planification → implémentation : suivi plus détaillé des étapes, statuts et erreurs (approbation de plan partiellement couverte).
- Modèles de prompts réutilisables (revue, tests, refactor, documentation).

---

## Long Terme

- Workflows multi-agents : comparer, critiquer ou compléter les réponses entre agents.
- Mode comparaison : même prompt à plusieurs agents, résultats côte à côte.
- Automatisations pilotées par session (relance de vérification, résumé, suite de tâches).
- Compatibilité avec d'autres protocoles ou passerelles.

---

## Pistes Techniques et UX

| Piste | Statut |
|-------|--------|
| Couverture de tests sur flux critiques | Partiel — bonne base sandcastle/pipelines/sessions ; webview et edge cases à compléter |
| Persistance locale (workspaces multiples, sessions supprimées, agents indisponibles) | Partiel — `SessionHistoryStore` en place ; cas limites à durcir |
| Politique de sécurité fichiers / terminal / approvals | Partiel — permissions ACP + auto-approve Sandcastle ; policies déclaratives à venir |
| Télémétrie optionnelle (fiabilité) | À faire |
| États UI quand l'agent ne supporte pas certaines capacités ACP | À faire |
| Dates debug en fuseau horaire local | À faire |
| Architecture : modules profonds, seams explicites | Partiel — ADR-0015, plugins, CONTEXT-MAP ; gros fichiers et dette vocabulaire restants |
| Documentation bilingue alignée (`docs/` / `doc_fr/`) | Partiel — glossaires FR avec termes EN ; pas de sync systématique |
| Skills workspace | Partiel — injection prompt OK ; UI, watcher, orchestration par rôle et doc à compléter |

---

## Nouvelles Idées à Explorer

- Prévisualiser et éditer le contexte injecté avant envoi à un nouvel agent.
- Historique des plans proposés, approuvés, rejetés ou modifiés.
- Comparer le plan approuvé avec les changements réellement produits par l'implémenteur.
- Centre de diagnostic : bundle de support filtré depuis les snapshots debug.
- Politiques de permissions par workspace ou par profil d'agent.

---

## Fonctionnalités Inspirées d'Omnigent

Périmètre volontairement local et centré VS Code : cloud, serveur déployé, multi-utilisateurs, co-drive distant et partage d'agents entre utilisateurs restent hors scope.

### 1. Agents déclaratifs en YAML — à faire

Objectif : agents réutilisables versionnés via `.acp/agents/*.yaml`, visibles comme agents virtuels locaux.

Reste à prévoir :

- `AgentProfileCatalog` chargeant `.acp/agents/*.yaml`.
- Validation du schéma YAML et erreurs dans le log ACP.
- Fusion profil local + configuration agent + options de session ACP.
- Watcher sur `.acp/agents/*.yaml`.
- Documentation dans `docs/agent-profiles.md`.

> Remarque v1 : si les profils exigent une forte customisation du prompt système, cadrer autour de `pi Agent` (`--system-prompt`, `--append-system-prompt`).

### 2. Instructions partagées — partiel

**Fait** : `InstructionResolver` + fichiers `.acp/agents/*.md` pour les équipes d'agents.

Reste à prévoir :

- Généraliser aux futurs profils d'agents YAML et pipelines autonomes.
- Afficher dans l'UI quel fichier d'instructions sera injecté.
- Prévisualisation du prompt final avant lancement.
- Format partageable pour distribuer instructions/skills avec un workspace.
- Lier explicitement aux skills workspace (voir section court terme) : éviter deux mécanismes parallèles non documentés.

### 3. Comparaison multi-agent — à faire

Envoyer le même prompt à plusieurs agents ACP, affichage côte à côte, synthèse optionnelle.

Reste à prévoir : profil `comparison` dans les pipelines, bloc UI côte à côte, annulation simultanée, synthèse par agent choisi.

### 4. Politiques déclaratives de sécurité — à faire

Verdicts `allow` / `deny` / `ask` composables pour shell, fichiers, réseau.

**Fait** : permissions ACP de base + sandbox Sandcastle.

Reste à prévoir : moteur de policies, application aux handlers et runs Sandcastle, UI des politiques actives, journalisation dans les snapshots debug.

### 5. Sandcastle — partiel

**Fait** : remplace le sandbox v1 (worktree git + bridge ACP + Docker) ; promotion Apply/Reject ; tests automatisés.

Reste à prévoir :

- Allowlist réseau applicative.
- Blocage des chemins hors sandbox au niveau terminal.
- Résumé clair des limites dans l'UI.
- Isolation OS optionnelle (macOS seatbelt, container) sans rendre le flux obligatoire.
- Scénarios manuels et smoke tests en conditions réelles.

### 6. Gestion avancée des sessions — partiel

**Fait** : chargement/reprise de session, cache local workspace, sessions virtuelles pipeline.

Reste à prévoir :

- Vue détaillée de session (agent, cwd, modèle, statut, dernier message).
- Mieux distinguer session active, restaurée et session pipeline interne.
- Recherche dans l'historique.

> Piste : lancer une session dans un conteneur Docker non préparé, y installer l'agent et s'authentifier — à cadrer (secrets).

### 7. Exemples prêts à l'emploi — partiel

**Fait** : pipelines dans `.acp/pipelines/save/`, équipe `feature-team` dans `.acp/teams/`, doc `docs/agent-teams.md`.

Reste à prévoir :

- Catalogue stable dans `.acp/examples` ou `docs/examples`.
- Exemple de comparaison multi-agent avec synthèse.
- Tests manuels reproductibles par exemple publié.

---

## Priorités Suggérées

1. **Renforcer et tester Sandcastle** — policies applicatives, contrôle réseau, UX des limites, isolation OS optionnelle (section 5, `docs/plans/omnigent/08-stronger-sandboxing.md`).
2. **Architecture et clean** — approfondir `SessionManager` / `PipelineService` / webview, corriger resume vs load, réduire duplication `EphemeralRun` (voir section court terme).
3. **Profils agents YAML** — `.acp/agents/*.yaml` et `AgentProfileCatalog` (section 1).
4. **Généraliser les instructions partagées** — au-delà des équipes, avec prévisualisation UI (section 2).
5. **Renforcer les skills workspace** — autocomplétion, watcher, validation, orchestration par rôle, doc (section court terme).
