# ADR-0009: Inline editor chat (editorInsets) for in-place prompts

**Status**: Accepted

## Contexte

Les utilisateurs souhaitent pouvoir envoyer des prompts contextuels "entre deux lignes" de l'éditeur, exactement comme le comportement attendu de Cmd+I (Copilot Inline Chat). L'API publique stable de VS Code ne permet pas d'insérer un champ input interactif directement entre les lignes ; une API proposée `editorInsets` expose cette capacité mais elle est non stable et réservée à VS Code Insiders / usage expérimental.

Nous devons livrer une UX "exacte" dans l'éditeur sans casser l'architecture agent/patch existante et en gardant la possibilité de rebasculer à une solution stable lorsque l'API sera finalisée.

## Décision

1. Utiliser l'API proposée `vscode.window.createWebviewTextEditorInset(...)` (editorInsets) pour afficher un webview inset entre les lignes du fichier quand la commande inline est déclenchée (Cmd+I).
2. Marquer cette UI comme expérimentale : documenter qu'elle nécessite VS Code Insiders et `--enable-proposed-api` pour le publisher de l'extension lors du développement et des tests.
3. Ne pas imbriquer la logique agent/patch dans l'inset : isoler la couche UI (inlineChat/) et garder la logique agentique (AcpAgentRunner, SessionManager) réutilisable indépendamment de l'API d'affichage.
4. Fournir un `InlineEditAgent` qui peut être implémenté par :
   - `MockInlineEditAgent` pour le développement/UX (réponses factices),
   - `AcpInlineEditAgent` qui utilise le runner éphémère pour spawn → connect → newSession → prompt → collect chunks.
5. Prévoir un mécanisme d'annulation (plan) : l'inset doit pouvoir annuler proprement une génération en cours via `connection.cancel()`/AbortSignal dans le runner (implémentation différée mais conçue dès le départ).
6. Ajouter une alternative fallback (utiliser `vscode.window.showInputBox`) uniquement pour les utilisateurs sur l'environnement où `editorInsets` n'est pas disponible ; éviter cette alternative par défaut car elle ne reproduit pas fidèlement l'UX recherchée.

## Conséquences

### Positives
- L'UX inline devient identique à l'objectif "Cmd+I" : prompt entre les lignes, accept/reject, preview et application de patch.
- Séparation claire UI ↔ agent : quand `editorInsets` sera stabilisé, seule la couche UI devra être ajustée.
- Le mock permet un développement rapide et des tests UX sans dépendance externe.

### Négatives / Risques
- L'usage de proposed APIs empêche la publication Marketplace de la fonctionnalité telle quelle ; il faut marquer la fonctionnalité expérimentale et documenter la limitation.
- Fragilité : breaking change possible à chaque version VS Code (changement API proposée).
- Support utilisateur : l'expérience n'est disponible que sur VS Code Insiders / avec activation de proposed APIs.

## Alternatives considérées

- Utiliser des hacks Monaco (addContentWidget/viewzones) : rejeté — API non supportée officiellement et source de bugs, maintenance élevée.
- Toujours utiliser `showInputBox()` : rejeté — n'offre pas l'intégration visuelle recherchée.
- Intégrer l'inline prompt dans le panneau latéral chat (via sendPromptFromExtension) : trop éloigné de l'objectif UX "inline between lines".

## Plan d'évolution

1. Garder la couche agent/patch inchangée et testée (AcpAgentRunner, PatchApplyService).  
2. Maintenir le mock pour dev et tests.  
3. Lorsque `editorInsets` devient stable, remplacer l'usage des APIs proposées et publier la fonctionnalité.  
4. Ajouter annulation robuste (AbortSignal) dans le runner et propager le signal depuis l'inset.

## Références

- Discussion d'origine sur l'input entre lignes : https://github.com/microsoft/vscode-discussions/discussions/2401  
- Documentation Proposed API: https://code.visualstudio.com/api/advanced-topics/using-proposed-api

