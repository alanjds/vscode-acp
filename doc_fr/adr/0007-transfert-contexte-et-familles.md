# ADR-0007 : transfert de contexte et familles de contexte

**Statut** : Acceptée

## Contexte
Lorsque les utilisateurs changent d'agent ou ouvrent une autre session, le chat visible change mais le contexte utile de la discussion ne suit pas. Les utilisateurs doivent copier manuellement les détails pertinents, et les sessions liées ne sont pas reliées dans l'historique. Le partage de contexte doit rester explicite, car les prompts peuvent contenir des données projet sensibles.

## Décision
Faire du transfert de contexte une action utilisateur explicite. Fournir deux commandes :
- `acp.connectAgentWithCurrentContext` - connecter un nouvel agent avec le contexte de la session actuelle
- `acp.openSessionWithCurrentContext` - charger ou reprendre une session existante avec le contexte actuel

Persister un transcript de discussion borné dans `SessionHistoryStore`. Lorsqu'un transfert de contexte est demandé, construire un payload compact depuis la session active, le stocker comme contexte en attente à usage unique sur la session cible, puis le préfixer seulement au prochain prompt. Après l'envoi de ce prompt, consommer le contexte en attente pour éviter les injections répétées.

Suivre les relations de contexte sur les entrées de session persistées :
- `contextFamilyId`
- `contextLinkedFrom`
- `contextLinkedAt`

Exposer la relation dans l'arbre des sessions et la bannière de chat, avec un indicateur de contexte en attente avant l'envoi du premier prompt. Ne pas partager le contexte automatiquement et ne pas propager un historique illimité.

## Conséquences
**Positives** :
- Réduit la répétition de contexte lors d'un changement d'agent ou d'une reprise dans une autre session.
- Rend les sessions liées traçables via les familles de contexte.
- L'injection à usage unique évite de transporter silencieusement l'ancien contexte dans chaque prompt futur.
- Les données de discussion bornées limitent la croissance du stockage et des prompts.
- Les commandes explicites préservent le contrôle utilisateur sur le contexte sensible.

**Négatives** :
- Ajoute des métadonnées et du stockage de discussion à l'historique des sessions.
- Ajoute un état de contexte en attente au cycle de vie des sessions.
- Les utilisateurs doivent choisir le chemin de transfert de contexte lorsqu'ils veulent de la continuité.

## Alternatives considérées
- Partage automatique implicite du contexte - rejeté pour des raisons de confidentialité et de contrôle utilisateur.
- Propagation illimitée de l'historique - rejeté car elle peut gonfler le stockage et les prompts.
- Copie manuelle uniquement - rejeté car elle est source d'erreurs et ne passe pas à l'échelle entre agents.
- Fusion de sessions - rejeté car elle masque les sessions sources et introduit une gestion de conflits.
