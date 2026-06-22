# ADR-0013: ACP bridge backed by Sandcastle

**Status**: Proposed — implementation POC complete, provider smoke tests pending

## Context

The legacy sandbox changes the working directory to a Git worktree but executes the ACP agent and its terminals on the host. Codex CLI and Cursor CLI are supported directly by Sandcastle, which can run them in a Docker isolation boundary while managing the worktree lifecycle.

## Decision

1. Package a separate Node process that implements an ACP agent over stdio.
2. Map each ACP session to one reusable Sandcastle Docker sandbox and explicit branch.
3. Support Codex and Cursor providers first; other ACP agents continue on the host with a warning.
4. Keep changes in the Sandcastle worktree until the user invokes Apply or Reject through ACP extension methods.
5. Rebuild bounded text history for both providers. Sandcastle 0.6.4 does not expose native resume on `createSandbox().run()`.
6. Keep ADR-0011 operational until the real Codex Apply and Cursor Reject smoke tests pass.

## Consequences

- The extension keeps one ACP-facing transport regardless of the underlying agent CLI.
- Agent commands run as a non-root user inside Docker, but outbound network access remains unrestricted in the POC.
- `.sandcastle/.env` holds provider API keys and must never be committed.
- The bundled bridge stdout is protocol-only; logs and diagnostics use stderr or `.sandcastle/logs`.
