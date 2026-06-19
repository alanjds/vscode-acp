# Plan Feature 05 - Politiques déclaratives de sécurité

## Inspiration Omnigent

Références :

- `docs/POLICIES.md` : https://github.com/omnigent-ai/omnigent/blob/main/docs/POLICIES.md
- `docs/AGENT_YAML_SPEC.md`, champ `policies` : https://github.com/omnigent-ai/omnigent/blob/main/docs/AGENT_YAML_SPEC.md
- Source package policies : https://github.com/omnigent-ai/omnigent/tree/main/omnigent

Omnigent formalise les policies comme des gates qui retournent `ALLOW`, `DENY` ou `ASK`, avec application au niveau session, agent et serveur. Pour ACP Client, l'équivalent doit rester local : workspace, profil agent, pipeline et session.

## Parallèle avec l'existant dans ACP Client

ACP Client a déjà des points de contrôle, mais ils sont dispersés :

- `src/handlers/PermissionHandler.ts` gère les approvals ACP ;
- `src/security/SecurityPolicy.ts` valide les chemins fichiers ;
- `src/handlers/FileSystemHandler.ts` et `src/handlers/TerminalHandler.ts` exécutent les actions sensibles ;
- `src/sandbox/NetworkPolicy.ts` contient une première allowlist réseau applicative ;
- `src/core/DebugTraceStore.ts` peut tracer les décisions.

Omnigent fournit une abstraction commune de verdict. ACP Client doit garder ses handlers, mais insérer une couche décisionnelle avant eux. Cela évite de multiplier les règles spécifiques dans chaque handler.

Le parallèle direct est donc :

- Omnigent policy gate -> futur `PolicyEngine` local ;
- Omnigent `ALLOW/DENY/ASK` -> verdict commun pour permission, fichier, terminal et réseau ;
- Omnigent policy stack session/agent/server -> stack ACP workspace/profil/session ;
- Omnigent audit des décisions -> événements dans `DebugTraceStore`.

## Objectif ACP Client

Remplacer progressivement `acp.autoApprovePermissions` par un moteur local de policies composables.

## Format cible

```yaml
policies:
  shell:
    default: ask
    deny:
      - "rm -rf"
      - "git reset --hard"
  files:
    writable:
      - .
    readonly:
      - docs
  network:
    allow:
      - github.com
      - registry.npmjs.org
```

## Intégration dans le code local

Points d'entrée existants :

- `src/handlers/PermissionHandler.ts` centralise les demandes de permission ACP.
- `src/handlers/FileSystemHandler.ts` applique les accès fichiers.
- `src/handlers/TerminalHandler.ts` exécute et suit les commandes.
- `src/security/SecurityPolicy.ts` protège déjà les chemins.
- `src/sandbox/NetworkPolicy.ts` contient une allowlist applicative.
- `src/core/DebugTraceStore.ts` stocke des traces exploitables.

Changements proposés :

- Créer `src/security/PolicyEngine.ts`.
- Définir `PolicyVerdict = allow | deny | ask`.
- Ajouter des événements : `file.read`, `file.write`, `terminal.create`, `terminal.kill`, `network.host`, `session.start`.
- Appliquer le moteur avant les handlers existants.
- Journaliser les décisions dans `DebugTraceStore`.
- Prévoir une migration : `autoApprovePermissions` devient une policy implicite.

## UX

- Afficher les policies actives dans un panneau session.
- Pour `ASK`, montrer la règle qui a déclenché la demande.
- Pour `DENY`, envoyer une erreur claire à l'agent et au chat.
- Ajouter une commande "Explain Active Policies".

## Risques

- Faux sentiment de sécurité si les commandes shell contournent l'analyse.
- Parsing shell incomplet.
- Friction utilisateur trop forte si les règles demandent trop souvent confirmation.

## Découpage

1. Moteur de verdict minimal.
2. Policies fichiers et terminal.
3. UI et debug traces.
4. Policies réseau et git.
5. Migration documentation.
