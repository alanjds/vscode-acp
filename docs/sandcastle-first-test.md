# First ACP–Sandcastle test

## Prerequisites

- Docker daemon running.
- Node.js and project dependencies installed.
- An OpenAI API key and a Cursor API key.

## Configure secrets

```bash
cp .sandcastle/.env.example .sandcastle/.env
```

Fill in `OPENAI_API_KEY` and `CURSOR_API_KEY`. The file is ignored by Git.

## Build the common image

On macOS/Linux, pass the host UID/GID so bind-mounted files keep the correct owner:

```bash
docker build \
  --build-arg AGENT_UID="$(id -u)" \
  --build-arg AGENT_GID="$(id -g)" \
  -t acp-client-sandcastle:local \
  -f .sandcastle/Dockerfile .
```

Verify both CLIs:

```bash
docker run --rm --entrypoint sh acp-client-sandcastle:local \
  -lc 'id && codex --version && cursor-agent --version'
```

## Automated smoke tests

Codex must create a sentinel in its worktree and Apply must transfer it temporarily:

```bash
npm run sandcastle:smoke:codex
```

Cursor must create a sentinel in its worktree and Reject must keep it out of the main workspace:

```bash
npm run sandcastle:smoke:cursor
```

Both scripts fail if the sentinel reaches the main workspace before promotion. They remove the sentinel after verification.

## Test in VS Code

1. Run `npm run compile`, then press `F5`.
2. Connect to **Codex Sandcastle** or **Cursor Sandcastle**.
3. Ask it to create or modify one small file.
4. Run `ACP: Sandcastle Show Diff` and inspect the patch.
5. Run Apply or Reject and verify the expected main-workspace state.
6. Use `ACP: Show Protocol Traffic` if initialization or streaming fails.

## Troubleshooting

- `image not found`: rebuild `acp-client-sandcastle:local`.
- authentication failure: verify both non-empty keys in `.sandcastle/.env`.
- UID mismatch: rebuild with the current `id -u` and `id -g`.
- no diff: ensure the prompt explicitly asks for a workspace file change.
- `Read-only file system` from Codex: rebuild/relaunch after updating the extension; Codex needs a writable `.sandcastle/codex-home/` mount, not a read-only `~/.codex` bind.
- native ACP warning: select the agent whose name ends with `Sandcastle`.
