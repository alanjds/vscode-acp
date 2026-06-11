# ADR-0001 : intégration du contexte éditeur

**Statut** : Acceptée

## Contexte
Les agents ACP fournissent de meilleures réponses lorsqu'ils ont accès à l'état courant de l'éditeur. Les utilisateurs copiaient manuellement du code, des chemins de fichiers et des positions de curseur dans les prompts. C'était fastidieux et source d'erreurs, surtout pour les opérations multi-fichiers.

Le protocole ACP prend en charge le contexte éditeur dans le prompt, mais il n'était pas exploité.

## Décision
Implémentation du module `EditorContext` pour capturer automatiquement :
- le chemin et le contenu du fichier courant ;
- la position du curseur (ligne, caractère) ;
- le texte sélectionné ;
- l'identifiant de langage ;
- la liste des éditeurs ouverts.

Ajout du setting `acp.editorContextLinked` (par défaut : false) pour activer ou désactiver l'injection automatique de contexte.

Quand il est activé, le contexte est préfixé aux prompts utilisateur avec une séparation visuelle claire.

## Conséquences
**Positives** :
- Moins de copier-coller manuel pour les prompts liés au code.
- Prise en compte du buffer courant, y compris les changements non sauvegardés.

**Négatives** :
- Le contenu du fichier courant peut être envoyé à l'agent si l'option est activée.
- Les gros fichiers peuvent ralentir la préparation du contexte.

