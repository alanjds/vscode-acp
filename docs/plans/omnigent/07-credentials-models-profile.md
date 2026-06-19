# Plan Feature 07 - Credentials et modèles par profil

## Inspiration Omnigent

Références :

- README, section "Choose & switch models" : https://github.com/omnigent-ai/omnigent#3-choose--switch-models
- `docs/AGENT_YAML_SPEC.md`, champ `executor` : https://github.com/omnigent-ai/omnigent/blob/main/docs/AGENT_YAML_SPEC.md

Omnigent distingue API key, abonnement CLI, gateway compatible, Databricks et valeurs par agent. ACP Client ne doit pas gérer tous les secrets directement, mais il peut documenter et diagnostiquer les prérequis par agent.

## Parallèle avec l'existant dans ACP Client

ACP Client délègue aujourd'hui l'authentification et les modèles aux agents ACP :

- `src/config/AgentConfig.ts` définit command, args, env et options MCP ;
- `src/core/ConnectionManager.ts` lance le process agent ;
- `src/core/SessionManager.ts` expose modes, models et configOptions quand l'agent les annonce ;
- `src/config/RegistryClient.ts` permet déjà de parcourir un registre ;
- `src/core/AgentError.ts` commence à structurer les erreurs.

Omnigent rend explicite le mode d'auth et le fournisseur. ACP Client doit éviter de stocker les secrets, mais peut modéliser les prérequis et les checks de santé pour réduire les erreurs opaques de lancement.

Le parallèle direct est donc :

- Omnigent `executor` avec provider/auth -> métadonnées agent registry ;
- Omnigent model par agent -> valeur par défaut de profil, puis override via configOptions ACP ;
- Omnigent gateway/API key -> documentation et diagnostic, pas stockage secret ;
- Omnigent runtime validation -> commande `ACP: Diagnose Agent`.

## Objectif ACP Client

Enrichir les profils et le registre d'agents avec installation, auth, health checks, modèles et options recommandées.

## Format cible

```yaml
version: 1
id: codex-workspace
title: Codex Workspace
agent: Codex CLI
model: gpt-5
auth:
  type: cli-subscription
  checkCommand: codex --version
install:
  command: npm install -g @openai/codex
healthCheck:
  command: codex auth status
```

## Intégration dans le code local

Points d'entrée existants :

- `src/config/AgentConfig.ts` décrit les agents configurés.
- `src/config/RegistryClient.ts` expose déjà un registre.
- `src/core/ConnectionManager.ts` lance les processus agent.
- `src/core/AgentError.ts` structure certaines erreurs.
- `src/ui/SessionTreeProvider.ts` peut afficher l'état de disponibilité.

Changements proposés :

- Ajouter des métadonnées `install`, `auth`, `healthCheck`, `models`.
- Ajouter une commande `ACP: Diagnose Agent`.
- Exécuter les checks sur demande, pas automatiquement au démarrage.
- Classer les états : ready, missing command, auth missing, unsupported platform, unknown error.
- Garder les secrets hors du YAML ; le YAML décrit seulement comment vérifier.

## UX

- Dans la tree view, badge d'état agent.
- Quick Pick de diagnostic avec actions suggérées.
- Messages d'erreur orientés action : commande absente, PATH, auth, cwd.

## Risques

- Les checks peuvent être lents ou dépendre du réseau.
- Les commandes de diagnostic varient selon OS.
- Il ne faut pas logguer de secrets.

## Découpage

1. Schéma de métadonnées.
2. Commande diagnostic manuelle.
3. Affichage état agent.
4. Documentation des agents préconfigurés.
