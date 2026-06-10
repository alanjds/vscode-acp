# ADR-0003: Session Fixes

**Status**: Accepted

## Context
Early session management had several issues:

1. **Race conditions**: `newSession` response and `session/update` notifications arrived in unpredictable order, causing UI to show stale state
2. **State duplication**: Session info stored in multiple places (SessionManager, tree view, chat webview) leading to inconsistencies
3. **Missing buffering**: Notifications arriving before session registration were lost
4. **No lifecycle tracking**: Couldn't distinguish between connecting, connected, and disconnected states

These caused: empty chat histories, wrong agent names displayed, commands failing silently.

## Decision
Implemented centralized session management with the following patterns:

**Single Source of Truth**:
- `SessionManager` owns all session state
- Tree and webview subscribe to updates via event emitter
- No direct state access, only through SessionManager API

**Notification Buffering**:
- `pendingAvailableCommands`, `pendingConfigOptions`, `pendingTitles` maps buffer notifications
- Drained when corresponding session is registered via `createAcpSession`
- Prevents data loss during initialization race

**Lifecycle States**:
- Explicit tracking: connecting → connected → disconnecting → disconnected
- Separate maps for sessions (`sessions`) and agent-to-session (`agentSessions`)
- `activeSessionId` tracks current session for single-agent mode

**Connection Flow**:
```
AgentManager.spawn() → ConnectionManager.connect() → SessionManager.ensureConnected()
                                    ↓
                              SessionManager.createAcpSession()
                                    ↓
                              Drains pending buffers
                                    ↓
                              Emits update events
```

## Consequences
**Positive**:
- Stable, predictable session state
- No lost notifications
- Consistent UI across tree and chat
- Easier to debug session issues

**Negative**:
- More complex initialization flow
- Additional memory for buffering (minimal)
- Need to handle buffer cleanup on session disposal

## Alternatives Considered
- Redux-style state management - rejected, overkill for this use case
- RxJS observables - rejected, adds dependency, team less familiar
- Keep current flow with more locks - rejected, doesn't solve buffering issue
