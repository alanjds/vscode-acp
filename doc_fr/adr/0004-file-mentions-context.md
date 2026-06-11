# ADR-0004 : mentions de fichiers pour le contexte de prompt

**Statut** : Acceptée

## Contexte
L'ancien workflow d'attachement de fichier utilisait une commande de toolbar et un sélecteur de fichier natif. Cela créait un chemin d'interaction séparé de la saisie du chat, ajoutait du bruit dans l'UI et insérait le contexte fichier dans un format plus difficile à modifier inline.

Les utilisateurs ont besoin d'un moyen rapide de référencer des fichiers du workspace pendant l'écriture d'un prompt. La référence doit être lisible dans le prompt, cliquable dans l'UI et non ambiguë pour l'agent.

## Décision
Remplacement de la commande attach-file par des mentions de fichiers dans le composer de chat :

- Taper `@` dans le prompt ouvre une popup webview avec les résultats de recherche de fichiers du workspace.
- La recherche de fichiers est gérée par l'extension host avec `vscode.workspace.findFiles`, pas par un accès direct au système de fichiers depuis la webview.
- Sélectionner un résultat insère une mention visible `@filename` suivie d'un espace.
- Le composer utilise une entrée `contenteditable` afin que les mentions de fichiers sélectionnées puissent être rendues comme éléments inline cliquables.
- Cliquer sur une mention de fichier envoie un message `openFile` à l'extension host, qui ouvre le fichier cible dans VS Code.
- La webview conserve les métadonnées des mentions sélectionnées `{ name, path, token }`.
- Avant d'envoyer un prompt à l'agent, les tokens visibles `@filename` sont étendus en `@relative/path/to/file` afin que l'agent reçoive une référence de fichier non ambiguë.

L'ancienne commande `acp.attachFile`, l'icône de toolbar, l'entrée de menu et le message webview `file-attached` ont été supprimés.

## Conséquences
**Positives** :
- Les fichiers sont référencés directement dans le prompt avec `@filename`.
- L'agent reçoit un chemin relatif à l'envoi, ce qui désambiguïse les noms dupliqués.
- L'ancienne action `acp.attachFile` et son UI sont supprimées.

**Négatives** :
- `contenteditable` impose une logique spécifique de curseur et synchronisation.
- Les métadonnées `{ name, path, token }` doivent rester synchronisées avec le texte édité.

## Alternatives envisagées
- Garder `attach-file` - rejeté car workflow séparé du prompt et doublon avec `@`.
- Chemins relatifs complets affichés - rejeté car cela alourdit le prompt visible.
- Noms de fichiers seuls - rejeté car ambigu en cas de doublons.
