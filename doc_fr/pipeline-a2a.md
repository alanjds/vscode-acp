# Ancienne page pipeline A2A

Les pipelines ne reposent plus sur le mécanisme A2A historique.

La documentation française à jour est maintenant ici :

- [Pipelines LangGraph ACP](./pipelines-langgraph.md)

Résumé du nouveau fonctionnement :

- les pipelines sont déclarés en YAML dans `.acp/pipelines/*.yaml` ;
- les **Équipes d'agents** sont déclarées dans `.acp/teams/*.yaml` et se compilent en pipelines ;
- chaque pipeline valide apparaît comme un agent virtuel dans VS Code ;
- LangGraph orchestrate les steps, les approvals et les branches parallèles ;
- ACP reste le protocole utilisé pour appeler les agents configurés ;
- les actions `sideEffects: workspace` doivent passer après une approbation humaine.

> **Note** : Pour les workflows basés sur des rôles (planner, implementer, reviewer, tester), les [Équipes d'agents](./agent-teams.md) offrent une syntaxe plus simple.
