# ADR-0008: Debug Tracing and Snapshots

**Status**: Accepted

## Context
Debugging ACP agent interactions and session management is difficult when protocol traffic, session updates, prompts, and client errors are split across logs or not captured at all. Support cases need an inspectable snapshot, but the extension must avoid hidden persistence or remote logging.

## Decision
Add an in-memory `DebugTraceStore` with bounded retention:
- Maximum 2,000 events
- Maximum 20 MB of payload data

Record ACP stream traffic, session updates, prompt lifecycle events, and client request/response/error events. Include lifecycle events in the trace model for extension-side transitions that do not map to protocol traffic.

Clone payloads into JSON-safe values before storing them, including errors, circular references, dates, bigint/symbol/function values, and binary data.

Expose `acp.openDebugSnapshot` through `DebugWebviewPanel`. The panel builds a snapshot containing extension version, active session metadata, optional chat state, and the current trace buffer. Users can refresh, copy, or export the JSON snapshot.

Do not persist traces automatically and do not send them anywhere without explicit user action.

## Consequences
**Positive**:
- Gives developers a single place to inspect recent ACP and client activity.
- Bounded retention prevents unbounded memory growth.
- JSON snapshots can be shared or analyzed outside VS Code when the user chooses.
- Safe cloning prevents bad payloads from corrupting the trace buffer.
- No automatic persistence or upload reduces privacy risk.

**Negative**:
- Adds memory and serialization overhead while the extension is running.
- Very large payloads may evict older events quickly.
- Trace data is lost on extension restart by design.

## Alternatives Considered
- Rely only on existing logs - rejected because logs do not consistently capture structured protocol and prompt context.
- Unbounded trace storage - rejected due to memory risk.
- Automatic persistence to disk - rejected due to privacy and cleanup concerns.
- Remote logging service - rejected due to privacy and offline requirements.
