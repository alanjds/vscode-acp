# ADR-0005 : pipelines de planning A2A pour l'implémentation avec Vibe

**Statut** : Acceptée

## Contexte
L'extension peut déjà se connecter à des agents de codage compatibles ACP, mais chaque session de chat cible généralement directement un agent ACP configuré. Le workflow pipeline ajoute une étape de planning relisible avant l'implémentation.

Il existe maintenant deux variantes de planner qui partagent la même étape d'implémentation :

1. `Codex Plan -> Vibe Implement`, où `Codex CLI` produit le plan.
2. `Gemini Plan -> Vibe Implement`, où `Gemini CLI` produit le plan.

Les deux pipelines utilisent `Vibe` comme implementer par défaut. L'utilisateur doit pouvoir relire et modifier le plan avant le démarrage de l'implémentation. Les sessions internes planner et implementer ne doivent pas apparaître comme des sessions ACP normales dans l'arbre, et la politique de permissions ACP existante doit continuer de gouverner les actions sur le système de fichiers et le terminal.

## Décision
Exposer deux agents synthétiques de pipeline qui routent les prompts à travers la même orchestration locale A2A/ACP :

- Exposer le pipeline Codex avec :
  - `acp.pipeline.enabled`
  - `acp.pipeline.virtualAgentName`
  - `acp.pipeline.plannerAgentName`
  - `acp.pipeline.implementerAgentName`
- Exposer le pipeline Gemini avec :
  - `acp.pipeline.geminiVirtualAgentName`
  - `acp.pipeline.geminiPlannerAgentName`
  - `acp.pipeline.geminiImplementerAgentName`
- Utiliser `acp.pipeline.enabled` comme feature toggle partagé pour les deux agents synthétiques de pipeline.
- Garder les agents ACP normaux inchangés et ne pas créer d'agents proxy ACP visibles pour le planner ou l'implementer internes.
- Démarrer des serveurs A2A JSON-RPC locaux pour le planner et l'implementer via `@a2a-js/sdk` et `express`.
- Appuyer chaque executor A2A sur une exécution ACP isolée qui :
  - lance le processus de l'agent ACP configuré ;
  - ouvre une session ACP ;
  - envoie le prompt généré ;
  - collecte la sortie `agent_message_chunk` ;
  - dispose les listeners, connexions et processus après réussite ou échec.
- Exiger que la réponse du planner contienne exactement un bloc `<proposed_plan>...</proposed_plan>`.
- Afficher ce bloc dans la webview comme plan éditable via `pipelinePlanReady`.
- Attendre `approvePipelinePlan` avant d'appeler l'implementer.
- Valider à nouveau le plan édité avant l'implémentation ; il doit contenir exactement un bloc `<proposed_plan>` et aucun texte en dehors.
- Envoyer le plan approuvé à Vibe via l'agent A2A implementer.
- Transmettre les mises à jour de session de l'implementer dans le chat du pipeline virtuel actif pour que l'utilisateur voie la progression de l'implémentation.
- Réutiliser le comportement de permission ACP existant (`ask` ou `allowAll`) pour les actions de Vibe.
- Prendre en charge la révision du plan avant approbation : un second prompt dans la même session pipeline renvoie au planner le plan précédent, le nouveau feedback/la nouvelle demande utilisateur et la demande originale.
- Résoudre les settings planner et implementer depuis l'agent synthétique de pipeline actif afin que chaque pipeline garde sa propre configuration.

## Conséquences
**Positives** :
- Validation humaine obligatoire avant l'appel à Vibe.
- Les sessions planner/implementer internes ne sont pas affichées comme agents ACP normaux.
- Codex et Gemini partagent la même orchestration tout en restant configurables par settings.
- Les permissions ACP existantes continuent de s'appliquer aux actions de Vibe.

**Négatives** :
- Deux serveurs HTTP locaux A2A sont lancés pendant l'exécution.
- Le pipeline dépend des agents planner/implementer configurés.
- Le format strict `<proposed_plan>` peut nécessiter un nouvel essai si le planner répond mal.
