# Plan Feature 06 - Budget et limites d'exécution

## Inspiration Omnigent

Références :

- `docs/POLICIES.md`, policies `max_tool_calls_per_session` et `cost_budget` : https://github.com/omnigent-ai/omnigent/blob/main/docs/POLICIES.md
- README, gouvernance des agents : https://github.com/omnigent-ai/omnigent#6-govern-your-agents-with-policies

Omnigent permet de plafonner les appels outils et le budget de coût. ACP Client ne maîtrise pas toujours le coût LLM exact des agents ACP, mais il peut mesurer et limiter les actions locales.

## Parallèle avec l'existant dans ACP Client

ACP Client observe déjà la plupart des actions locales, sans les compter comme budget :

- `src/core/SessionManager.ts` pilote les turns et l'annulation ;
- `src/core/SessionState.ts` porte l'état de session ;
- `src/handlers/FileSystemHandler.ts` voit les lectures/écritures fichiers ;
- `src/handlers/TerminalHandler.ts` voit les terminaux créés, attendus, tués et relâchés ;
- `src/core/SessionUpdateBuffer.ts` agrège les updates envoyées au chat.

Omnigent applique des budgets sur les tools et coûts. ACP Client peut commencer par des budgets déterministes sur les actions qu'il contrôle déjà, puis brancher ces limites au futur `PolicyEngine`.

Le parallèle direct est donc :

- Omnigent `max_tool_calls_per_session` -> compteurs handlers ACP ;
- Omnigent `cost_budget` -> placeholder futur, dépendant des métadonnées agent ACP ;
- Omnigent limite de run -> timeout dans `SessionManager` et annulation process ;
- Omnigent policy denial -> réponse d'erreur claire vers l'agent ACP.

## Objectif ACP Client

Ajouter des limites locales par session : nombre d'actions, durée, commandes terminal, accès fichiers et taille de contexte injecté.

## Format cible

```yaml
limits:
  maxToolCalls: 80
  maxTerminalCommands: 20
  maxFileWrites: 40
  maxRunDurationSeconds: 1800
  maxInjectedContextBytes: 120000
```

## Intégration dans le code local

Points d'entrée existants :

- `src/core/SessionState.ts` porte l'état session.
- `src/core/SessionUpdateBuffer.ts` agrège les updates.
- `src/core/SessionManager.ts` pilote les turns.
- `src/handlers/FileSystemHandler.ts` et `TerminalHandler.ts` sont les meilleurs points de comptage.
- `src/commands/RegisterCommands.ts` contient déjà l'annulation.

Changements proposés :

- Ajouter `SessionBudgetState`.
- Compter les actions par session et par type.
- Ajouter un timer de turn/run.
- Transformer les dépassements en verdict `DENY` via le futur `PolicyEngine`.
- Envoyer une réponse claire à l'agent quand une limite est atteinte.

## UX

- Afficher un compteur compact dans le chat : actions, durée, état.
- Prévenir quand un seuil approche.
- Ajouter une action "Extend limit for this session".
- Faire en sorte que stop annule aussi les sous-runs et terminaux actifs.

## Risques

- Certains agents ACP ne reportent pas toutes leurs actions de manière homogène.
- Les limites peuvent bloquer des workflows légitimes longs.
- Les durées doivent être reliées à l'annulation réelle du process.

## Découpage

1. Compteurs passifs et affichage debug.
2. Blocage sur max tool calls.
3. Timeout de turn avec annulation.
4. UI de seuils et overrides session.
