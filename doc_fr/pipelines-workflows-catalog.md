# Catalogue de workflows LangGraph ACP

Ce catalogue rassemble des workflows YAML prêts à charger depuis `.acp/pipelines`.

Objectif : tester beaucoup de formes d'orchestration sans changer le code de l'extension. Les workflows sont volontairement variés : audit read-only, planification parallèle, approval avant édition, et réconciliation de propositions multi-edit.

## Règles de lancement

- Tous les workflows utilisent `Codex CLI`.
- Les workflows qui écrivent dans le workspace utilisent aussi `Vibe`.
- Les workflows read-only ont uniquement `sideEffects: none`.
- Les workflows d'édition passent par un step `approval` avant tout `sideEffects: workspace`.
- Le moteur actuel interdit les edits workspace dans un step `parallel`. Les workflows multi-edit utilisent donc le pattern :

```text
propositions parallèles read-only -> réconciliation -> approbation -> application unique -> vérification
```

## Démos de base

| Agent virtuel | Fichier | Pattern | Usage |
|---------------|---------|---------|-------|
| `Demo Simple` | `.acp/pipelines/demo-simple.yaml` | analyse -> réponse | Tester le chargement minimal d'un pipeline. |
| `Demo Parallel Review` | `.acp/pipelines/demo-parallel-review.yaml` | cadrage -> code + tests/docs en parallèle -> synthèse | Tester un premier vrai step parallèle. |
| `Plan Execute Verify` | `.acp/pipelines/plan-execute-verify.yaml` | plan -> approval -> execute -> verify | Flux standard de modification contrôlée. |

## Multi-edit et réconciliation

| Agent virtuel | Fichier | Pattern | Usage |
|---------------|---------|---------|-------|
| `Parallel Patch Proposals Reconcile` | `.acp/pipelines/parallel-patch-proposals-reconcile.yaml` | 3 propositions de patch -> réconciliation -> approval -> implémentation -> vérification | Comparer patch minimal, refactor durable et expérimentation réversible avant de trancher. |
| `Multi Edit Design Board` | `.acp/pipelines/multi-edit-design-board.yaml` | design state + UI + infra en parallèle -> réconciliation -> approval -> exécution -> vérification | Préparer une feature multi-fichiers avec dépendances entre domaines. |
| `Feature Variants Arbiter` | `.acp/pipelines/feature-variants-arbiter.yaml` | variante safe + variante ambitieuse + variante delight -> arbitrage -> approval -> implémentation | Explorer plusieurs directions produit/tech avant d'en choisir une. |
| `Code Tests Docs Reconcile` | `.acp/pipelines/code-tests-docs-reconcile.yaml` | plan code + plan tests + plan docs -> réconciliation -> approval -> implémentation -> review | Garder code, tests et documentation synchronisés. |
| `Spec Tests Implementation Reconcile` | `.acp/pipelines/spec-tests-implementation-reconcile.yaml` | spec + tests + implémentation -> réconciliation -> approval -> exécution -> vérification | Forcer l'alignement entre spécification, preuve et patch. |
| `Reconciliation Only Review` | `.acp/pipelines/reconciliation-only-review.yaml` | produit + engineering + risque en parallèle -> décision | Réconcilier des avis contradictoires sans modifier le workspace. |

## Flows avec édition après approbation

| Agent virtuel | Fichier | Pattern | Usage |
|---------------|---------|---------|-------|
| `Bugfix Test Driven` | `.acp/pipelines/bugfix-test-driven.yaml` | reproduction/plan -> approval -> patch -> verify | Corriger un bug en commençant par une preuve testable. |
| `Safe Refactor Lane` | `.acp/pipelines/safe-refactor-lane.yaml` | plan de refactor -> approval -> refactor -> audit | Refactorer sans changement fonctionnel volontaire. |
| `Docs Update Approved` | `.acp/pipelines/docs-update-approved.yaml` | plan docs -> approval -> rédaction -> review | Modifier la documentation avec validation humaine. |

## Audits read-only

| Agent virtuel | Fichier | Pattern | Usage |
|---------------|---------|---------|-------|
| `Deep PR Review` | `.acp/pipelines/deep-pr-review.yaml` | correctness + tests + maintainability + security -> synthèse | Produire une vraie revue de PR multi-angle. |
| `Security Threat Model` | `.acp/pipelines/security-threat-model.yaml` | auth + input + secrets -> threat model | Auditer les frontières de confiance et menaces. |
| `CI CD Security Hardening` | `.acp/pipelines/cicd-security-hardening.yaml` | permissions + actions + artifacts -> plan de durcissement | Durcir GitHub Actions, secrets, provenance et supply chain. |
| `API Contract Guardian` | `.acp/pipelines/api-contract-guardian.yaml` | surface + compatibilité + contract tests -> rapport | Protéger une API publique contre les régressions. |
| `Config Env Audit` | `.acp/pipelines/config-env-audit.yaml` | defaults + secrets/env + runtime modes -> rapport | Auditer settings, variables d'environnement et modes runtime. |
| `Accessibility Review` | `.acp/pipelines/accessibility-review.yaml` | clavier + sémantique + visuel -> checklist | Vérifier accessibilité d'un parcours UI. |
| `Localization Readiness` | `.acp/pipelines/localization-readiness.yaml` | strings + layout + formats -> rapport | Préparer une interface à la traduction. |
| `Tech Debt Radar` | `.acp/pipelines/tech-debt-radar.yaml` | complexité + stabilité + produit -> backlog | Identifier et prioriser la dette technique. |

## Qualité, tests et CI

| Agent virtuel | Fichier | Pattern | Usage |
|---------------|---------|---------|-------|
| `Failing CI Rescue` | `.acp/pipelines/failing-ci-rescue.yaml` | triage -> causes code/tests + environnement + changements récents -> plan | Diagnostiquer un CI rouge sans patch immédiat. |
| `Flaky Test Hunter` | `.acp/pipelines/flaky-test-hunter.yaml` | temps/ordre + état partagé + variance CI -> plan | Stabiliser un test intermittent. |
| `Test Gap Radar` | `.acp/pipelines/test-gap-radar.yaml` | unit + integration + manual -> stratégie | Trouver les trous de couverture utiles. |
| `Agentic PR Preflight` | `.acp/pipelines/agentic-pr-preflight.yaml` | risque diff + trajectoire CI + paquet review -> checklist | Vérifier une PR générée par agent avant soumission. |
| `Dependency Upgrade Scout` | `.acp/pipelines/dependency-upgrade-scout.yaml` | API breaks + lockfiles + validation -> plan | Préparer une mise à jour de dépendance. |
| `Performance Hotspot Scan` | `.acp/pipelines/performance-hotspot-scan.yaml` | runtime + frontend + mesure -> rapport | Chercher les hotspots avant optimisation. |

## Produit, release et exploitation

| Agent virtuel | Fichier | Pattern | Usage |
|---------------|---------|---------|-------|
| `Release Readiness` | `.acp/pipelines/release-readiness.yaml` | qualité + docs + ops -> checklist go/no-go | Préparer une release. |
| `Release Notes Builder` | `.acp/pipelines/release-notes-builder.yaml` | changements user + breaking + interne -> notes | Rédiger des release notes. |
| `Incident Postmortem` | `.acp/pipelines/incident-postmortem.yaml` | timeline + causes + prévention -> postmortem | Produire un postmortem blameless. |
| `Migration Blueprint` | `.acp/pipelines/migration-blueprint.yaml` | code + données/config + tests -> blueprint | Planifier une migration risquée. |
| `Experiment Design` | `.acp/pipelines/experiment-design.yaml` | hypothèse + instrumentation + rollout -> brief | Préparer une expérimentation produit. |
| `UX Copy Polish` | `.acp/pipelines/ux-copy-polish.yaml` | flow + copy + polish -> recommandations | Améliorer une expérience et sa microcopy. |
| `Onboarding Map` | `.acp/pipelines/onboarding-map.yaml` | architecture + workflows + premières tâches -> guide | Aider un nouveau contributeur à comprendre le repo. |
| `Cleanup Dead Code Plan` | `.acp/pipelines/cleanup-dead-code-plan.yaml` | entrypoints + refs + rollout -> plan | Supprimer du code mort sans casser d'usage caché. |

## Inspirations utilisées

Les workflows ont été élargis après recherche externe, notamment autour de ces thèmes :

- test-driven agentic repair : https://arxiv.org/abs/2510.23761
- workflow explicite, parallèle et human-in-the-loop : https://arxiv.org/abs/2604.13346
- sécurisation GitHub Actions : https://docs.github.com/en/actions/reference/security/secure-use
- fonctionnalités de sécurité GitHub : https://docs.github.com/en/code-security/getting-started/github-security-features
- OWASP Top 10 CI/CD Security Risks : https://owasp.org/www-project-top-10-ci-cd-security-risks/
- culture postmortem blameless SRE : https://sre.google/sre-book/postmortem-culture/

