# ADR-0006: Workspace-Scoped Session History

**Status**: Accepted

## Context
Session history was stored in a global scope using `acp.sessionHistory.v1`. When the same agent is used across multiple workspaces, this mixes unrelated sessions and makes the tree view unreliable. The extension also needs a common workspace identity so `SessionManager`, `SessionTreeProvider`, and persisted history resolve the same scope.

## Decision
Introduce `WorkspaceIdentity` as the shared identity for session scoping. Resolve the workspace in this order:
1. `acp.defaultWorkingDirectory`
2. The workspace folder for the active editor, otherwise the first workspace folder
3. `process.cwd()`

Migrate local history from `acp.sessionHistory.v1` to `acp.sessionHistory.v2`. Persist entries with a normalized `workspaceKey`, `cwd`, `agentName`, and `sessionId`, so lookups are scoped by workspace and agent.

Keep a local lifecycle status for each cached session:
- `available` - session is present and accessible
- `missing` - session cannot be found
- `agentUnavailable` - agent is not available
- `agentRemoved` - agent has been removed

Show only available sessions by default, but retain stale records so the extension does not silently destroy history. `Forget Session` remains the explicit deletion action.

## Consequences
**Positive**:
- Prevents sessions from different workspaces from appearing together.
- Gives session creation, loading, and tree rendering the same workspace scope.
- Preserves existing local history through migration.
- Avoids silent deletion when agents cannot list or resume a session.

**Negative**:
- Requires a storage migration from v1 to v2.
- Adds status and reconciliation logic to the local cache.
- Workspace resolution can still be ambiguous when no VS Code workspace is open.

## Alternatives Considered
- Keep one global list and filter by `cwd` at render time - rejected because it leaves session creation and lookup without a stable shared identity.
- Create separate memento keys per workspace - rejected because migration and cleanup become harder than a single versioned store.
- Auto-delete missing sessions - rejected because transient agent failures would cause data loss.
- Keep v1 unchanged - rejected because it does not support workspace-scoped history.
