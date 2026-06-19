# Plan Feature 04 - Comparaison multi-agent

## Inspiration Omnigent

Références :

- README, exemple Debby : https://github.com/omnigent-ai/omnigent#polly-and-debby
- README, supervision de plusieurs agents : https://github.com/omnigent-ai/omnigent#why-omnigent
- Exemples Omnigent : https://github.com/omnigent-ai/omnigent/tree/main/examples

Omnigent décrit Debby comme un agent à deux têtes qui envoie chaque question à Claude et GPT, affiche les réponses côte à côte et peut lancer une phase de débat. ACP Client peut reprendre ce pattern sous forme de pipeline local.

## Parallèle avec l'existant dans ACP Client

ACP Client supporte déjà les branches parallèles read-only dans le DSL pipeline :

- `docs/pipeline-a2a.md` documente `type: parallel` ;
- `src/pipeline/PipelineGraphCompiler.ts` expose les sorties via `steps.<parallel>.branches.<branch>.output` ;
- `src/test/PipelineService.test.ts` couvre l'exécution parallèle read-only.

Ce qui manque est l'expérience produit Debby : une réponse comparative lisible, avec colonnes, statuts et synthèse optionnelle. Aujourd'hui les sorties pipeline restent proches d'un flux chat linéaire.

Le parallèle direct est donc :

- Omnigent Debby two-headed agent -> pipeline ACP `parallel` avec deux branches ;
- Omnigent side-by-side UI -> nouveau composant webview `ComparisonBlock` ;
- Omnigent debate/final answer -> étape de synthèse optionnelle ;
- contrainte locale ACP -> branches read-only pour éviter les écritures concurrentes.

## Objectif ACP Client

Ajouter un mode de comparaison qui envoie le même prompt à plusieurs agents ACP et affiche les résultats côte à côte.

## Format cible

```yaml
version: 1
id: compare-agents
title: Compare Agents
type: comparison
agents:
  - name: Codex CLI
    label: Codex
  - name: Claude Code
    label: Claude
synthesis:
  agent: Codex CLI
  enabled: true
```

## Intégration dans le code local

Points d'entrée existants :

- `src/pipeline/PipelineGraphCompiler.ts` supporte déjà `type: parallel`.
- `src/test/PipelineService.test.ts` couvre les branches parallèles read-only.
- `webview/src/components/TurnBlock.tsx` et `MessageBubble.tsx` affichent les réponses.
- `webview/src/components/PipelinePlanBlock.tsx` peut inspirer un bloc structuré.

Changements proposés :

- Ajouter un template de pipeline `comparison`.
- Créer un composant `ComparisonBlock`.
- Exposer les sorties de branches sous forme stable dans l'état webview.
- Ajouter une étape de synthèse optionnelle après les branches.
- Garantir que le bouton stop annule toutes les branches.

## UX

- Affichage en colonnes sur desktop.
- Affichage en tabs ou accordéon sur largeur réduite.
- Bouton "Synthétiser" si la synthèse n'est pas automatique.
- Badges pour agent, modèle, durée et statut.

## Risques

- Coût et latence plus élevés.
- Résultats difficiles à comparer si chaque agent utilise un format très différent.
- Annulation partielle laissant une branche active.

## Découpage

1. Ajouter un pipeline exemple read-only.
2. Ajouter le bloc UI côte à côte.
3. Ajouter synthèse optionnelle.
4. Ajouter tests d'annulation multi-branches.
