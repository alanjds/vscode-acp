# ADR-0011 : Sandbox agent via git worktree

**Statut** : Remplacé par [ADR-0013](../docs/adr/0013-acp-sandcastle-bridge.md) — retiré de l'extension

## Contexte

Les étapes de pipeline avec `sideEffects: workspace` peuvent modifier le workspace via les handlers FS/terminal ACP. On veut un mode « yolo contrôlé » : l'agent modifie un worktree isolé, puis l'utilisateur revoit un diff et des checks avant promotion.

L'extension borne déjà les accès avec `SecurityPolicy.validatePath(workspaceRoot)` mais ne crée pas de répertoire d'exécution séparé.

## Décision

1. Sandbox opt-in (`acp.sandbox.enabled`) : **git worktree** par run sous `.acp/sandboxes/{id}`.
2. Le worktree sert de `cwd` pour `AcpAgentRunner`, spawn, `newSession` et handlers FS/terminal.
3. **Promotion gate** native : résumé diff, lint/tests optionnels, Appliquer ou Rejeter.
4. Appliquer : `git apply` du diff sandbox vers le workspace ; Rejeter : suppression du worktree.
5. Allowlist réseau documentée comme policy applicative v1 (pas de firewall OS).

## Conséquences

- Étapes pipeline à effet workspace plus sûres si sandbox activé.
- Nécessite un dépôt git.
- Pas de confinement total si l'agent lance des shells hors handlers ACP.
- Sessions longues et UI webview de promotion : phase ultérieure.

## Alternatives envisagées

- **Docker obligatoire** : meilleure isolation, UX plus lourde.
- **Écriture directe workspace** : comportement actuel si sandbox désactivé.
