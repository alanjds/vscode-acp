# ADR-0015: Extension runtime bootstrap and virtual session seam

**Status**: Accepted

## Context

`extension.ts` had grown into a monolithic bootstrap: core services, UI wiring, event forwarding, pipeline orchestration, and Sandcastle commands all lived in one file. `SessionManager` and `ChatWebviewController` also carried orchestration-specific knowledge (`PipelineService`, pipeline webview messages, plan approval handlers).

The extension supports two conversation transports:

| Transport | Examples | Process |
|-----------|----------|---------|
| **Native ACP** | Claude, Codex CLI, Sandcastle bridge | Spawned ACP agent over stdio |
| **Virtual** | Pipeline and agent-team agents | LangGraph in-process, no ACP child |

Both transports must appear identical to the user (agent tree, chat webview, session history, context handoff). The code structure did not reflect that split.

## Decision

1. **Thin `extension.ts`, fat `ExtensionRuntime`.**
   - `activate()` delegates to `startExtensionRuntime()`.
   - `RuntimeResources` owns registration order and disposes in reverse on failure or shutdown.
   - Core services and UI are wired once in `initializeExtensionRuntime()`.

2. **Feature plugins for optional product surfaces.**
   - `FeaturePluginRegistry` activates `OrchestrationPlugin`, `SandcastlePlugin`, and `InlineChatPlugin` with typed contexts.
   - Each plugin registers its own commands, watchers, and runtime objects.
   - Duplicate plugin IDs fail fast at startup.

3. **`VirtualSessionRuntime` as the extension point for non-ACP conversations.**
   - Interface: `canHandle`, `createSession`, `sendPrompt`, `cancel`, `dispose`.
   - `SessionManager` keeps the native ACP path built in; it delegates to a single registered virtual runtime when `canHandle(agentName)` is true.
   - Virtual sessions are tagged `transport: 'virtual'` in `SessionInfo`; `isVirtualSession()` gates cancel and prompt routing.
   - Only one virtual runtime may be registered at a time (today: `OrchestrationRuntime`).

4. **`OrchestrationRuntime` owns all pipeline runtime concerns.**
   - Created and activated by `OrchestrationPlugin`; registers itself on `SessionManager`.
   - Subscribes to `PipelineService` events and forwards them to the chat webview.
   - Registers `approvePipelinePlan` / `rejectPipelinePlan` handlers via `ChatWebviewController.registerFeatureMessageHandler()`.
   - Persists pipeline message chunks through `SessionManager` public record APIs.
   - `SessionManager` no longer accepts `setPipelineService()`.

5. **`SandcastlePromotion` concentrates promotion actions.**
   - Resolves the active Sandcastle session and connection, then delegates to `SandcastlePromotionUi`.
   - `SandcastlePlugin` only registers VS Code commands and user-facing error handling.

6. **`ChatWebviewController` stays transport-agnostic.**
   - Pipeline-specific message types and handlers moved out of the controller.
   - Features extend the webview through `registerFeatureMessageHandler()` with one handler per message type.

## Consequences

### Positive

- **Clear boundaries**: ACP lifecycle in `SessionManager`; orchestration lifecycle in `OrchestrationRuntime`; Sandcastle promotion in `SandcastlePromotion`.
- **Easier navigation**: `extension.ts` is a stable entry point; feature code lives under `src/plugins/` and `src/runtime/`.
- **Testability**: virtual session routing and orchestration event forwarding can be tested without spinning the full extension.
- **Safer startup**: `RuntimeResources` rolls back partial initialization if a plugin throws during activation.

### Negative

- **Single virtual runtime slot**: a second virtual transport (e.g. a future inline-only runtime) would need either composition inside one runtime or a registry refactor.
- **Indirection**: following a prompt from webview to LangGraph now crosses plugin → runtime → session manager → runtime again.

### Neutral

- User-visible behaviour is unchanged: pipelines and teams still appear as agents in the tree and chat like native ACP agents.
- Sandcastle promotion still requires an active Sandcastle-backed session; orchestration only triggers the promotion gate when the implementer step uses Sandcastle ([ADR-0012](0012-agent-teams.md), [ADR-0013](0013-acp-sandcastle-bridge.md)).

## Alternatives considered

### Alternative 1: Keep `PipelineService` inside `SessionManager`

**Proposal**: Continue calling `sessionManager.setPipelineService()` at bootstrap and branch on agent type inside `sendPrompt()`.

**Rejected because**:
- `SessionManager` would remain coupled to LangGraph orchestration.
- Every new virtual transport would add more branches to an already large class.
- Pipeline webview events would keep leaking into core session code.

### Alternative 2: Fake ACP for virtual agents

**Proposal**: Run pipelines through a local ACP shim process so all sessions share one code path.

**Rejected because**:
- Adds process spawn overhead for in-process LangGraph work.
- Serialisation and debugging become harder without meaningful isolation benefit.
- Virtual sessions already need different disconnect/cancel semantics (no child process to kill).

### Alternative 3: Multiple virtual runtimes registered in parallel

**Proposal**: Allow `SessionManager` to hold a list of `VirtualSessionRuntime` implementations.

**Deferred because**:
- Only orchestration needs the virtual path today.
- A single slot with a clear error on double registration is simpler and forces an explicit merge if a second transport appears.

## Related ADRs

- [ADR-0005: A2A ACP Pipeline](0005-a2a-acp-pipeline.md) — LangGraph orchestration engine consumed by `OrchestrationRuntime`
- [ADR-0012: Agent Teams](0012-agent-teams.md) — virtual agents compiled into pipelines
- [ADR-0013: ACP Sandcastle bridge](0013-acp-sandcastle-bridge.md) — native ACP transport with promotion
- [ADR-0014: Sandcastle bounded prompt history](0014-sandcastle-bounded-prompt-history.md)
