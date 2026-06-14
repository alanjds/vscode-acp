# ADR-0007: Shared Context Handoff and Context Families

**Status**: Accepted

## Context
When users switch agents or open another session, the visible chat changes but the useful discussion context does not move with them. Users have to copy relevant details manually, and related sessions are not linked in history. Context sharing must be explicit because prompts can contain sensitive project data.

## Decision
Make context handoff an explicit user action. Provide two commands:
- `acp.connectAgentWithCurrentContext` - connect a new agent with the current session's context
- `acp.openSessionWithCurrentContext` - load or resume an existing session with the current context

Persist a bounded discussion transcript in `SessionHistoryStore`. When context handoff is requested, build a compact context payload from the active session, store it as one-shot pending context on the target session, and prepend it only to the next prompt. After that prompt is sent, consume the pending context to avoid repeated injection.

Track context relationships on persisted session entries:
- `contextFamilyId`
- `contextLinkedFrom`
- `contextLinkedAt`

Expose the relationship in the session tree and chat banner, including a pending-context indicator before the first prompt is sent. Do not share context automatically and do not propagate unlimited history.

## Consequences
**Positive**:
- Reduces repeated setup when switching agents or continuing in another session.
- Keeps related sessions traceable through context families.
- One-shot injection avoids silently carrying old context into every future prompt.
- Bounded persisted discussion data limits storage and prompt growth.
- Explicit commands preserve user control over sensitive context.

**Negative**:
- Adds metadata and discussion storage to session history.
- Adds pending-context state to the session lifecycle.
- Users must choose the context handoff path when they want continuity.

## Alternatives Considered
- Implicit automatic context sharing - rejected due to privacy and lack of user control.
- Unbounded history propagation - rejected because it can bloat storage and prompts.
- Manual copy-paste only - rejected because it is error-prone and does not scale across agents.
- Session merging - rejected because it obscures source sessions and introduces conflict handling.
