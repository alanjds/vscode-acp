# ADR-0002 : migration de la webview vers React

**Statut** : Acceptée

## Contexte
L'implémentation initiale de la webview utilisait du HTML/JS/CSS vanilla. À mesure que les fonctionnalités ont grandi (historique de chat, appels d'outils, rendu Markdown, arbres de fichiers), le code est devenu :
- difficile à maintenir et à étendre ;
- sans réutilisation de composants ;
- sujet aux erreurs de manipulation manuelle du DOM ;
- sans gestion d'état ;
- difficile à tester.

## Décision
Migration de la webview de chat vers React 18 avec TypeScript. Changements principaux :

**Architecture** :
- composants React pour chaque type de message (utilisateur, agent, appel d'outil, erreur) ;
- état géré via hooks React et context ;
- historique des messages sous forme de tableau immuable ;
- Webpack 5 pour le bundling.

**Composants** :
- `ChatWebviewProvider` - couche d'intégration VS Code ;
- `MessageBubble`, `Picker`, `PlanBlock`, `ThoughtBlock`, `TurnBlock`, `TurnTools` - composants UI réutilisables ;
- modules CSS pour le styling scopé.

**Build** :
- configuration Webpack avec loader TypeScript ;
- compilation séparée du build de l'extension ;
- hot reload pour le développement.

## Conséquences
**Positives** :
- Les types de messages et appels d'outils sont isolés dans des composants React typés.
- L'état du chat n'est plus géré par manipulation manuelle du DOM.

**Négatives** :
- Ajout de dépendances frontend (`react`, `react-dom`, `webpack`).
- Pipeline Webpack/TypeScript supplémentaire à maintenir.
