# Workflow de pipeline A2A

ACP Client inclut des agents virtuels optionnels qui découpent une tâche en deux phases :

1. Un agent ACP planner produit un bloc unique `<proposed_plan>`.
2. L'utilisateur relit, modifie, approuve ou rejette le plan.
3. Un agent ACP implementer reçoit le plan approuvé et effectue les changements dans le workspace.

L'agent virtuel est exposé dans la même vue Agents que les agents ACP normaux, mais en interne il démarre des serveurs A2A JSON-RPC locaux sur `127.0.0.1` et fait le pont entre chaque requête A2A et les agents ACP configurés.

## Agents virtuels disponibles

Deux presets de pipeline sont disponibles quand `acp.pipeline.enabled` vaut `true` :

| Agent virtuel | Planner | Implementer |
|---------------|---------|-------------|
| `Codex Plan -> Vibe Implement` | `Codex CLI` | `Vibe` |
| `Gemini Plan -> Vibe Implement` | `Gemini CLI` | `Vibe` |

Les noms affichés et les agents sous-jacents sont configurables avec les settings `acp.pipeline.*`.

## Settings

| Setting | Valeur par défaut | Objectif |
|---------|-------------------|----------|
| `acp.pipeline.enabled` | `true` | Affiche ou masque les agents virtuels de pipeline. |
| `acp.pipeline.virtualAgentName` | `Codex Plan -> Vibe Implement` | Nom affiché pour le pipeline basé sur Codex. |
| `acp.pipeline.plannerAgentName` | `Codex CLI` | Agent ACP utilisé pour le planning dans le pipeline basé sur Codex. |
| `acp.pipeline.implementerAgentName` | `Vibe` | Agent ACP utilisé pour l'implémentation dans le pipeline basé sur Codex. |
| `acp.pipeline.geminiVirtualAgentName` | `Gemini Plan -> Vibe Implement` | Nom affiché pour le pipeline basé sur Gemini. |
| `acp.pipeline.geminiPlannerAgentName` | `Gemini CLI` | Agent ACP utilisé pour le planning dans le pipeline basé sur Gemini. |
| `acp.pipeline.geminiImplementerAgentName` | `Vibe` | Agent ACP utilisé pour l'implémentation dans le pipeline basé sur Gemini. |

Chaque nom de planner ou d'implementer configuré doit exister dans `acp.agents`. Le pipeline n'installe pas les agents automatiquement.

## Flux utilisateur

1. Ouvrir la vue de barre d'activité ACP Client.
2. Se connecter à l'un des agents virtuels de pipeline.
3. Envoyer la tâche comme un prompt de chat normal.
4. Attendre l'apparition du plan proposé.
5. Modifier le plan si nécessaire.
6. Cliquer sur approuver pour démarrer l'implémentation, ou rejeter pour arrêter l'exécution.
7. Suivre la sortie d'implémentation dans le chat et inspecter les logs ACP en cas d'échec.

## Modes d'échec

| Symptôme | Cause probable | Correction |
|----------|----------------|------------|
| `Missing configured ACP pipeline agent(s)` | Le nom du planner ou de l'implementer n'existe pas dans `acp.agents`. | Mettre à jour `acp.pipeline.*` ou ajouter la configuration d'agent manquante. |
| Le planner ne retourne jamais de plan | Le planner n'a pas émis exactement un bloc `<proposed_plan>`. | Réessayer avec une demande plus claire ou inspecter les logs de l'agent planner. |
| L'implémentation échoue immédiatement | L'agent implementer ne peut pas démarrer, s'authentifier ou initialiser ACP. | Vérifier le `PATH`, les identifiants et les logs ACP Client. |
| Pipeline annulé | Le tour actif a été annulé ou la session virtuelle a été déconnectée. | Se reconnecter à l'agent virtuel et démarrer une nouvelle demande. |
| Le démarrage du serveur A2A local échoue | Le binding de port ou le réseau local est bloqué. | Vérifier que les connexions loopback `127.0.0.1` sont autorisées. |

## Notes

- Le planner reçoit l'instruction de ne pas modifier le workspace.
- L'implementer reçoit le prompt original plus le plan approuvé.
- La gestion existante des permissions ACP continue de s'appliquer aux actions sur le système de fichiers et le terminal.
- Du point de vue du chat, le pipeline est une session unique ; les exécutions planner et implementer sont des détails d'implémentation.
