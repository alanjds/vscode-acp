# ADR-0009 : Inline chat dans l'éditeur via `editorInsets`

**Status** : Accepté

## Contexte

Les utilisateurs veulent pouvoir taper un prompt directement entre deux lignes d'un fichier (comportement « Cmd+I »). L'API publique stable de VS Code ne le permet pas ; l'API proposée `editorInsets` permet d'insérer un webview interactif entre les lignes, mais elle est instable et réservée à VS Code Insiders / usage expérimental.

Il faut fournir l'UX recherchée sans mélanger la logique agent/patch et en restant prêt à basculer vers l'API stable quand elle sera disponible.

## Décision

1. Utiliser `vscode.window.createWebviewTextEditorInset(...)` (API proposée `editorInsets`) pour afficher le widget inline lorsque la commande inline est appelée (Cmd+I).
2. Marquer la fonctionnalité comme expérimentale : nécessite VS Code Insiders et activation des proposed APIs pour le développement et les tests.
3. Conserver la séparation UI ↔ agent : implémenter la couche UI dans `src/inlineChat/` et garder la logique agent (AcpAgentRunner, SessionManager) indépendante et réutilisable.
4. Fournir deux implémentations d'agent :
   - `MockInlineEditAgent` pour le développement UX sans agent réel,
   - `AcpInlineEditAgent` pour le branchement vers le runner ACP (spawn → connect → newSession → prompt → streaming).
5. Prévoir un mécanisme d'annulation propre via `connection.cancel()` / AbortSignal dans le runner (planifié, implémentation à venir).
6. Éviter `showInputBox()` comme fallback par défaut — il ne reproduit pas l'expérience inline.

## Conséquences

**Positives** : UX fidèle à l'objectif, découplage UI/agent, facile à remplacer quand `editorInsets` sera stable.  
**Négatives** : fonctionnalité non publiable sur Marketplace en l'état, fragile face aux changements d'API, disponible seulement sur Insiders avec proposed APIs activées.

## Alternatives examinées

- Hacks Monaco (viewZones/contentWidget) : rejetés pour maintenance et compatibilité.  
- `showInputBox()` comme fallback : rejeté pour mauvaise UX.  
- Poster le prompt directement dans le panneau de chat : rejeté car ne répond pas au besoin inline.

## Évolution

1. Maintenir mock pour dev.  
2. Prévoir et implémenter annulation (AbortSignal) côté runner.  
3. Remplacer l'usage des proposed APIs par l'API stable dès qu'elle est disponible.

