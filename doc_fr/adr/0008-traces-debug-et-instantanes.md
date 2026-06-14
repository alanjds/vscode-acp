# ADR-0008 : traces debug et instantanés

**Statut** : Acceptée

## Contexte
Le débogage des interactions ACP et de la gestion des sessions est difficile lorsque le trafic protocolaire, les mises à jour de session, les prompts et les erreurs client sont dispersés dans les logs ou non capturés. Les cas de support ont besoin d'un instantané inspectable, mais l'extension doit éviter la persistance cachée et la journalisation distante.

## Décision
Ajouter un `DebugTraceStore` en mémoire avec une rétention bornée :
- Maximum 2 000 événements
- Maximum 20 Mo de données de payload

Enregistrer le trafic de stream ACP, les mises à jour de session, le cycle de vie des prompts et les événements de requête/réponse/erreur client. Inclure les événements de cycle de vie dans le modèle de trace pour les transitions côté extension qui ne correspondent pas à du trafic protocolaire.

Cloner les payloads vers des valeurs sûres pour JSON avant stockage, y compris les erreurs, références circulaires, dates, valeurs bigint/symbol/function et données binaires.

Exposer `acp.openDebugSnapshot` via `DebugWebviewPanel`. Le panneau construit un instantané contenant la version de l'extension, les métadonnées de la session active, l'état de chat optionnel et le buffer de traces courant. Les utilisateurs peuvent rafraîchir, copier ou exporter l'instantané JSON.

Ne pas persister les traces automatiquement et ne rien envoyer sans action explicite de l'utilisateur.

## Conséquences
**Positives** :
- Donne aux développeurs un endroit unique pour inspecter l'activité ACP et client récente.
- La rétention bornée évite une croissance mémoire illimitée.
- Les instantanés JSON peuvent être partagés ou analysés hors de VS Code quand l'utilisateur le choisit.
- Le clonage sûr empêche les payloads problématiques de corrompre le buffer de traces.
- L'absence de persistance ou d'envoi automatique réduit le risque de confidentialité.

**Négatives** :
- Ajoute une surcharge mémoire et de sérialisation pendant l'exécution de l'extension.
- Les très gros payloads peuvent évincer rapidement les événements plus anciens.
- Les données de trace sont perdues au redémarrage de l'extension, par conception.

## Alternatives considérées
- S'appuyer seulement sur les logs existants - rejeté car les logs ne capturent pas toujours le contexte protocolaire et les prompts de manière structurée.
- Stockage des traces illimité - rejeté en raison du risque mémoire.
- Persistance automatique sur disque - rejeté pour des raisons de confidentialité et de nettoyage.
- Service de journalisation distant - rejeté pour des raisons de confidentialité et de fonctionnement hors ligne.
