# Core

Domaine central de conversation de l’extension : comment l’utilisateur choisit un agent, mène un chat interactif, persiste les métadonnées de session et transmet éventuellement le contexte de discussion à une autre conversation.

## Agents et connexion

**ConfiguredAgent** :
Entrée agent sélectionnable dans l’arbre — depuis les paramètres du workspace ou un nom virtual découvert (pipeline ou équipe).
_À éviter_ : agent (nu), modèle, provider

**ConnectedAgent** :
Le seul processus agent actuellement lancé et lié au chat interactif. Un seul ConnectedAgent peut être actif à la fois.
_À éviter_ : session, connexion, agent actif

**Workspace** :
Dossier workspace VS Code qui borne la configuration des agents, les SessionRecords et le répertoire de travail des conversations.
_À éviter_ : cwd (en parlant à l’utilisateur), racine du projet

## Cycle de vie de la conversation

**Conversation** :
Fil interactif en direct affiché dans le panneau chat — état runtime plus l’historique à l’écran de la session active.
_À éviter_ : chat, thread, session (nu)

**ProtocolSession** :
Identifiant de session et contrat de capacités côté agent ACP. L’extension s’y conforme, mais l’utilisateur doit raisonner en Conversation et SessionRecord.
_À éviter_ : session (quand on parle de toute la conversation)

**SessionRecord** :
Fiche d’index persistée localement pour une conversation passée ou en cours : nom d’agent, id ProtocolSession, titre, horodatages, Discussion optionnelle et liens de famille de contexte. Alimente l’arbre des sessions et le handoff.
_À éviter_ : session (nu), session en cache, entrée d’historique

**NewConversation** :
Démarrer une nouvelle ProtocolSession avec le même ConnectedAgent, en effaçant le chat visible. Distinct de l’ouverture d’un ancien SessionRecord depuis l’arbre.
_À éviter_ : reset, clear chat (comme nom de domaine)

## Historique et présentation

**Discussion** :
Transcript plat et borné de texte utilisateur et assistant (sans détail d’outils), stocké sur un SessionRecord. Sert au handoff de contexte et aux familles de contexte — pas au replay UI riche.
_À éviter_ : historique, transcript, journal de chat

**ChatHistory** :
État de présentation riche en mémoire du panneau chat : tours, appels d’outils, blocs de réflexion, blocs UI pipeline et markdown rendu. Reconstruit depuis les mises à jour streamées ACP ou le replay de load de session.
_À éviter_ : discussion, transcript

**Turn** :
Un prompt utilisateur et l’activité assistant (texte, outils, pensées) produite avant le prochain prompt utilisateur dans ChatHistory.
_À éviter_ : message (quand on parle du tour entier), round

**SessionSnapshot** :
Projection des métadonnées de la Conversation active dans le chrome du composeur (nom affiché de l’agent, titre, modes, badge famille de contexte, indicateur de handoff en attente).
_À éviter_ : session, SessionRecord

## Transport

**Transport** :
Comment une Conversation est exécutée : `nativeAcp` (processus ACP sur l’hôte), `sandcastle` (bridge ACP vers isolation Docker), ou `virtual` (orchestration in-process, sans enfant ACP direct pour l’agent virtual lui-même).
_À éviter_ : runtime (ambigu), mode

**EphemeralAgentRunner** :
Seam partagé pour EphemeralRun — route vers ACP natif ou Sandcastle selon le ConfiguredAgent. Utilisé par PipelineExecutor et InlineEditAgent.
_À éviter_ : runEphemeralSandcastleAgent (détail d’implémentation Sandcastle)

**AgentConnectionFactory** :
Spawn → connect pour **EphemeralRun** (court-circuit ACP). Distinct de **SessionConnector** qui gère le cycle **ConnectedAgent** longue durée — deux seams intentionnels, pas une fusion à faire.
_À éviter_ : connectEphemeralAcpAgent (détail d’implémentation)

**spawnAndConnectNativeAgent** :
Helper partagé par **nativeSessionConnect** (connectToAgent, ensureConnected). Ne remplace pas AgentConnectionFactory : lifecycle ConnectedAgent, pas EphemeralRun.

**SessionConnector** :
Façade qui route connect/disconnect par **Transport** — `virtualSessionConnect` (virtual) · `nativeSessionConnect` (nativeAcp/sandcastle) · `disconnectAgentSession`.

**VirtualAgentCatalog** :
Résolution unifiée des noms d’agents (configured, pipeline, team) pour l’arbre Agents et les runtimes.
_À éviter_ : getAgentNames + isPipelineVirtualAgentName + isTeamVirtualAgentName (combinaison historique)

## Partage de contexte

**EditorContext** :
Instantané optionnel de l’éditeur actif (fichier, sélection, éditeurs ouverts) ajouté au prochain prompt utilisateur lorsque le lien contexte éditeur est activé.
_À éviter_ : contexte fichier, @-mention (le contexte éditeur est distinct des mentions de fichiers)

**ContextHandoff** :
Action utilisateur explicite qui copie la Discussion de la Conversation courante vers une Conversation cible. Le texte copié est préfixé uniquement au prochain prompt sortant, puis consommé.
_À éviter_ : sync, merge, partager l’historique

**ContextFamily** :
Ensemble de SessionRecords liés parce qu’un a été ouvert ou connecté avec un ContextHandoff depuis un autre. Visible dans l’arbre et la bannière du chat.
_À éviter_ : groupe de sessions, famille de threads

**PendingHandoff** :
État où une Conversation cible a reçu une Discussion via ContextHandoff mais l’utilisateur n’a pas encore envoyé le prochain prompt qui la consommera.
_À éviter_ : contexte en attente, contexte partagé (comme nom)

## Présentation (webview)

L’application React du panneau chat détient ChatHistory et SessionSnapshot. C’est une projection de la Conversation, pas une seconde source de vérité pour le handoff ni le contexte provider Sandcastle.

**ConversationProjector** :
Seam de projection unique côté extension host : transforme les mises à jour entrantes (ACP natif, Sandcastle, OrchestrationRun) en effets **Discussion** / **SessionRecord** et en messages webview pour **ChatHistory**. `SessionManager.applyConversationEffects` applique les effets session ; les appelants (`ChatWebviewController`, `OrchestrationRuntime`) relaient les `webviewMessages`.
_À éviter_ : chemins d’ingest parallèles hors `projectAndApply`
