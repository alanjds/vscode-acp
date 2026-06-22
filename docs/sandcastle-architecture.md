# ACP–Sandcastle POC architecture

## Data flow

```text
VS Code extension
  -> ACP NDJSON over stdio
  -> dist/sandcastle-acp-bridge.js
  -> @ai-hero/sandcastle
  -> Docker sandbox + Git worktree
  -> Codex CLI or Cursor Agent CLI
```

The bridge is a normal ACP agent from the extension's point of view. `AgentManager` launches it with the selected provider and model. `session/new` creates a branch named `sandcastle/acp/<provider>/<uuid>` and starts the Docker sandbox. `session/prompt` calls `sandbox.run()` and converts Sandcastle text/tool events into ACP session updates.

## Configuration

Legacy agent entries omit `transport` and continue to launch their configured ACP command on the host. Sandcastle entries use:

```json
{
  "transport": "sandcastle",
  "provider": "codex",
  "model": "gpt-5.4",
  "effort": "high",
  "env": {}
}
```

Supported POC providers are `codex` and `cursor`. The Docker image defaults to `acp-client-sandcastle:local`; set `ACP_SANDCASTLE_IMAGE` in the agent `env` object to override it.

## Session and promotion lifecycle

- One ACP session owns one warm Sandcastle sandbox.
- Prompts are serialized per session. Cancellation aborts the active Sandcastle run.
- The latest eight user/assistant turns are reconstructed, bounded to 64 KiB.
- The main workspace is untouched until `sandcastle/apply` succeeds.
- `sandcastle/preview` returns the binary Git diff and file count.
- Apply performs `git apply --check`, applies the patch, cleans the managed worktree, and closes the sandbox.
- Reject cleans the managed worktree and closes the sandbox without touching the main workspace.
- A later prompt recreates a sandbox from the current HEAD.

The VS Code commands `ACP: Sandcastle Show Diff`, `Apply Changes`, and `Reject Changes` call these ACP extension methods. Ephemeral pipeline/inline runs open the same promotion dialog before terminating the bridge.

## Security boundary and limitations

- Codex and Cursor execute as the non-root `agent` user in Docker.
- Only the Sandcastle-managed Git/worktree mounts are configured by this POC.
- Docker's default bridge network is used because both providers need outbound API access; no egress allowlist is enforced yet.
- Provider keys are loaded from `.sandcastle/.env` and must not appear in settings, logs, or commits.
- Non-Sandcastle ACP agents still execute on the host and display a warning.
- Native Codex session resume is deferred because Sandcastle 0.6.4 does not expose it on reusable sandbox runs. See [ADR-0014](adr/0014-sandcastle-bounded-prompt-history.md).
