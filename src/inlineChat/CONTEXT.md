# Inline chat

Prompting local à l’éditeur qui propose des modifications de texte structurées, sans rejoindre l’arbre d’agents principal ni l’index SessionRecord.

## Interaction

**InlineEdit** :
Prompt utilisateur ancré à la sélection de l’éditeur actif (ou au curseur), ouvert en inset près du code. Produit une proposition de patch, pas un fil de chat dans le panneau principal.
_À éviter_ : inline chat (comme nom de domaine), édition rapide

**EditProposal** :
Réponse structurée de l’agent à un InlineEdit : court résumé plus une ou plusieurs plages de remplacement dans le fichier.
_À éviter_ : réponse, suggestion, complétion

**Patch** :
Ensemble validé de remplacements de texte dérivé d’un EditProposal, prêt à être appliqué au document.
_À éviter_ : diff, edit (ambigu avec InlineEdit)

**PatchDecision** :
Acceptation ou rejet par l’utilisateur d’un Patch après revue dans l’UI inset.
_À éviter_ : apply (quand on parle de Promotion Sandcastle), confirmer

## Exécution

**InlineEditAgent** :
Backend qui transforme une requête InlineEdit en EditProposal. Peut déléguer à un EphemeralRun sur un ConfiguredAgent.
_À éviter_ : agent inline, fournisseur d’édition

**EditorInset** :
Surface UI hébergeant InlineEdit dans le chrome éditeur. Webview distincte du panneau chat principal.
_À éviter_ : panneau inline, popup

## Relations avec Core

- InlineEdit ne crée pas de Conversation, SessionRecord ni entrée d’arbre.
- Le ConfiguredAgent par défaut pour un InlineEdit est le ConnectedAgent actif s’il n’est pas VirtualAgent ; sinon le premier ConfiguredAgent non virtual du workspace.
- InlineEdit partage le modèle EphemeralRun avec les primitives pipeline mais n’utilise pas ContextHandoff, Discussion ni ChatHistory.
