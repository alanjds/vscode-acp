# ADR-0011: Agent sandbox via git worktree

**Status**: Superseded by [ADR-0013](0013-acp-sandcastle-bridge.md) — removed from the extension

## Context

Pipeline steps with `sideEffects: workspace` can modify the user's workspace directly through ACP file-system and terminal handlers. Users want a controlled "yolo" mode where agents can change code freely inside an isolated environment, then review and promote changes only after optional lint/tests.

The extension already scopes agent file access with `SecurityPolicy.validatePath(workspaceRoot)` but does not isolate runs in separate directories.

## Decision

1. Add an opt-in sandbox (`acp.sandbox.enabled`) that creates a **git worktree** per workspace-changing run under `.acp/sandboxes/{id}`.
2. Pass the worktree path as `cwd` to `AcpAgentRunner`, spawn, `newSession`, and FS/terminal handlers so writes stay inside the sandbox root.
3. After the run, show a **promotion gate** (native VS Code UI): diff summary, optional lint/test commands, Apply or Reject.
4. On Apply, patch the main workspace with `git apply` from the sandbox diff; on Reject, remove the worktree.
5. Document network allowlist as application-level policy only in v1 (no OS-level egress control).

## Consequences

- Workspace-changing pipeline steps are safer when sandbox is enabled.
- Requires a git repository in the workspace.
- Agents that spawn their own shells outside ACP handlers are not fully contained.
- Interactive long-lived sandbox sessions and webview promotion UI are deferred to a later phase.

## Alternatives considered

- **Docker mandatory**: stronger isolation but poor cross-platform UX.
- **Direct workspace writes**: current default when sandbox is disabled.
