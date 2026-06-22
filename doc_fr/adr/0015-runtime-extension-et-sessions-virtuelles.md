# ADR-0015 : Bootstrap du runtime d'extension et seam des sessions virtuelles

**Statut** : Accepté

## Contexte

`extension.ts` était devenu un bootstrap monolithique : services cœur, câblage UI, relais d'événements, orchestration pipeline et commandes Sandcastle cohabitaient dans un seul fichier. `SessionManager` et `ChatWebviewController` portaient aussi la connaissance spécifique à l'orchestration (`PipelineService`, messages webview pipeline, handlers d'approbation de plan).

L'extension supporte deux transports de conversation :

| Transport | Exemples | Exécution |
|-----------|----------|-----------|
| **ACP natif** | Claude, Codex CLI, bridge Sandcastle | Agent ACP lancé sur stdio |
| **Virtuel** | Agents pipeline et équipes d'agents | LangGraph in-process, sans processus ACP enfant |

Les deux transports doivent paraître identiques à l'utilisateur (arbre des agents, webview chat, historique, transfert de contexte). La structure du code ne reflétait pas cette séparation.

## Décision

1. **`extension.ts` mince, `ExtensionRuntime` épais.**
   - `activate()` délègue à `startExtensionRuntime()`.
   - `RuntimeResources` gère l'ordre d'enregistrement et dispose en sens inverse en cas d'échec ou à l'arrêt.
   - Services cœur et UI sont câblés une fois dans `initializeExtensionRuntime()`.

2. **Plugins de fonctionnalités pour les surfaces produit optionnelles.**
   - `FeaturePluginRegistry` active `OrchestrationPlugin`, `SandcastlePlugin` et `InlineChatPlugin` avec des contextes typés.
   - Chaque plugin enregistre ses propres commandes, watchers et objets runtime.
   - Les IDs de plugin en double échouent immédiatement au démarrage.

3. **`VirtualSessionRuntime` comme point d'extension pour les conversations non-ACP.**
   - Interface : `canHandle`, `createSession`, `sendPrompt`, `cancel`, `dispose`.
   - `SessionManager` conserve le chemin ACP natif en interne ; il délègue à un seul runtime virtuel enregistré quand `canHandle(agentName)` est vrai.
   - Les sessions virtuelles sont marquées `transport: 'virtual'` dans `SessionInfo` ; `isVirtualSession()` conditionne l'annulation et le routage des prompts.
   - Un seul runtime virtuel peut être enregistré à la fois (aujourd'hui : `OrchestrationRuntime`).

4. **`OrchestrationRuntime` possède toutes les préoccupations runtime pipeline.**
   - Créé et activé par `OrchestrationPlugin` ; s'enregistre sur `SessionManager`.
   - S'abonne aux événements `PipelineService` et les transmet à la webview chat.
   - Enregistre les handlers `approvePipelinePlan` / `rejectPipelinePlan` via `ChatWebviewController.registerFeatureMessageHandler()`.
   - Persiste les chunks de messages pipeline via les API publiques d'enregistrement de `SessionManager`.
   - `SessionManager` n'accepte plus `setPipelineService()`.

5. **`SandcastlePromotion` concentre les actions de promotion.**
   - Résout la session Sandcastle active et la connexion, puis délègue à `SandcastlePromotionUi`.
   - `SandcastlePlugin` ne fait qu'enregistrer les commandes VS Code et la gestion d'erreurs utilisateur.

6. **`ChatWebviewController` reste agnostique du transport.**
   - Types de messages et handlers spécifiques pipeline sortis du contrôleur.
   - Les fonctionnalités étendent la webview via `registerFeatureMessageHandler()`, un handler par type de message.

## Conséquences

### Positives

- **Frontières claires** : cycle de vie ACP dans `SessionManager` ; cycle de vie orchestration dans `OrchestrationRuntime` ; promotion Sandcastle dans `SandcastlePromotion`.
- **Navigation facilitée** : `extension.ts` est un point d'entrée stable ; le code fonctionnel vit sous `src/plugins/` et `src/runtime/`.
- **Testabilité** : routage des sessions virtuelles et relais d'événements orchestration testables sans lancer toute l'extension.
- **Démarrage plus sûr** : `RuntimeResources` annule une initialisation partielle si un plugin échoue à l'activation.

### Négatives

- **Emplacement unique pour le runtime virtuel** : un second transport virtuel (ex. runtime inline dédié) nécessiterait soit une composition dans un seul runtime, soit une refonte du registre.
- **Indirection** : suivre un prompt de la webview à LangGraph traverse plugin → runtime → session manager → runtime.

### Neutres

- Le comportement visible par l'utilisateur est inchangé : pipelines et équipes apparaissent toujours comme des agents dans l'arbre et le chat, comme les agents ACP natifs.
- La promotion Sandcastle exige toujours une session active Sandcastle ; l'orchestration n'affiche la passerelle de promotion que lorsque l'étape implementer utilise Sandcastle ([ADR-0012](0012-equipes-agents.md), [ADR-0013](../docs/adr/0013-acp-sandcastle-bridge.md)).


## ADRs liés

- [ADR-0005 : Pipeline A2A ACP](0005-a2a-acp-pipeline.md) — moteur d'orchestration LangGraph consommé par `OrchestrationRuntime`
- [ADR-0012 : Équipes d'agents](0012-equipes-agents.md) — agents virtuels compilés en pipelines
- [ADR-0013 : Bridge ACP Sandcastle](../docs/adr/0013-acp-sandcastle-bridge.md) — transport ACP natif avec promotion
- [ADR-0014 : Historique de prompts Sandcastle borné](../docs/adr/0014-sandcastle-bounded-prompt-history.md)
