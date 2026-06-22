# ADR-0014: Bounded prompt history for Sandcastle agents

**Status**: Proposed — implemented in POC, native provider resume deferred

## Context

Native ACP agents (host-side CLI) maintain conversation state inside the agent process. The extension sends only the current user message on each `session/prompt`, keyed by `sessionId`. When the agent advertises `session/load` or `session/resume`, the extension can reopen past sessions without manually replaying history.

The Sandcastle bridge (ADR-0013) maps each ACP session to a reusable Docker sandbox and calls `sandbox.run()` per prompt. Sandcastle **0.6.4** does not expose native provider session resume on `createSandbox().run()`. Each run starts Codex CLI or Cursor Agent CLI without access to the provider's prior in-container session state.

The extension already persists a bounded discussion transcript in `SessionHistoryStore` (ADR-0006, ADR-0007) for the session tree and explicit cross-agent context handoff. That store is client-side UI/metadata; it does not feed Sandcastle provider runs today.

## Decision

1. **Do not advertise** `session/load` or `session/resume` on the Sandcastle bridge (`loadSession: false` in `initialize`).
2. **Maintain bridge-local history** in memory per ACP session (`BridgeSession.history: PromptHistoryEntry[]`).
3. **Reconstruct context on every prompt** via `buildPromptWithHistory()` in `src/sandcastle/PromptHistory.ts`:
   - keep at most the **16 most recent messages** (8 user/assistant turns),
   - cap total injected text at **64 KiB** UTF-8, including the current prompt,
   - walk history from newest to oldest; stop when either limit is reached,
   - format as a plain-text transcript (`User:` / `Assistant:`) prepended to the current request.
4. **Append** each completed turn (user prompt + assistant stdout) to bridge history after a successful run.
5. **Clear bridge history** when the Sandcastle sandbox is discarded (`apply`, `reject`, `closeSession`, or bridge shutdown). Do not attempt to hydrate bridge history from `SessionHistoryStore` in the POC.
6. **Defer native provider resume** until Sandcastle exposes it on reusable sandbox runs; revisit this ADR when upgrading `@ai-hero/sandcastle`.

## Consequences

**Positive**:
- Multi-turn Sandcastle conversations work within a single live bridge session without waiting for Sandcastle resume APIs.
- Bounded limits prevent unbounded prompt growth and reduce token/cost risk.
- The extension chat UI still receives full streamed output via ACP `session/update`; only what the provider sees is truncated.
- Keeps the Sandcastle bridge a thin ACP adapter; no duplicate persistence layer in the POC.

**Negative**:
- Provider context is **textual and heuristic**, not a native Codex/Cursor session — tool-call detail, reasoning traces, and provider-internal state are not faithfully restored.
- History is **volatile**: lost on bridge process exit, Apply/Reject (sandbox discard), or sandbox recreation.
- **64 KiB / 8 turns** is far smaller than typical native agent context windows.
- No `session/load` or `session/resume` for Sandcastle agents in the session tree workflow.
- `SessionHistoryStore` discussion data and bridge history can **diverge** (extension remembers more for UI; provider sees less).
- Cross-agent context handoff (ADR-0007) prepends one-shot shared context at the extension layer; Sandcastle then applies its own history reconstruction on top.

## Relationship to other ADRs

| ADR | Role |
|-----|------|
| ADR-0013 | Introduces the Sandcastle bridge |
| ADR-0006 | Workspace-scoped session metadata in the extension |
| ADR-0007 | One-shot shared discussion context between agents |
| ADR-0011 | Legacy host worktree sandbox; native agent session model unchanged |

## Alternatives considered

- **Rely on Sandcastle/provider native resume** — preferred long-term, but unavailable in Sandcastle 0.6.4 for `createSandbox().run()`.
- **Hydrate bridge history from `SessionHistoryStore` on reconnect** — rejected for POC: different bounds, risk of stale or duplicated context, and no stable sync contract yet.
- **Send full chat history from the extension on every prompt** — rejected: duplicates responsibility and breaks the ACP contract used by native agents.
- **Unbounded transcript injection** — rejected: uncontrolled token cost and provider limit failures.
- **Persist bridge history to disk** — deferred: adds schema, privacy, and reconciliation concerns.

## Follow-up

- Re-evaluate when `@ai-hero/sandcastle` exposes session resume on reusable sandboxes.
- If native resume is adopted, remove or narrow `PromptHistory` and advertise `session/resume` where appropriate.
- Consider aligning bridge bounds with `SessionHistoryStore` limits if client-side hydration becomes necessary.
