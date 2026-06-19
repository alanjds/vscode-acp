# Plans Omnigent

Ces plans détaillent les fonctionnalités Omnigent à adapter dans ACP Client, en conservant un périmètre local centré VS Code.

Hors périmètre pour cette série :

- cloud sandboxes provisionnés par serveur ;
- application web/mobile distante ;
- comptes multi-utilisateurs, invitations et administration d'équipe ;
- partage de sessions ou d'agents entre utilisateurs ;
- co-drive distant ;
- fork distant vers une autre machine ;
- déploiement serveur Docker/Railway/Fly/Render.

## Plans par feature

Chaque plan contient maintenant :

- l'inspiration Omnigent ;
- le parallèle précis avec l'existant du plugin ACP Client ;
- les points d'intégration code ;
- les risques et un découpage d'implémentation.

1. [Agents déclaratifs en YAML](./01-agent-yaml-profiles.md)
2. [Instructions partagées par agent](./02-shared-agent-instructions.md)
3. [Sous-agents et reviewers déclaratifs](./03-subagents-reviewers.md)
4. [Comparaison multi-agent](./04-multi-agent-comparison.md)
5. [Politiques déclaratives de sécurité](./05-declarative-policies.md)
6. [Budget et limites d'exécution](./06-budgets-execution-limits.md)
7. [Credentials et modèles par profil](./07-credentials-models-profile.md)
8. [Sandboxing renforcé](./08-stronger-sandboxing.md)
9. [Sessions attachables localement](./09-local-attachable-sessions.md)
10. [Exemples prêts à l'emploi](./10-ready-made-examples.md)

## Sources Omnigent principales

- README Omnigent : https://github.com/omnigent-ai/omnigent#readme
- Spec Agent YAML : https://github.com/omnigent-ai/omnigent/blob/main/docs/AGENT_YAML_SPEC.md
- Guide des policies : https://github.com/omnigent-ai/omnigent/blob/main/docs/POLICIES.md
- Exemples Omnigent : https://github.com/omnigent-ai/omnigent/tree/main/examples
- Package source Omnigent : https://github.com/omnigent-ai/omnigent/tree/main/omnigent
