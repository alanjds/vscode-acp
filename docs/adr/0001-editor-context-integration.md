# ADR-0001: Editor Context Integration

**Status**: Accepted

## Context
ACP agents provide better responses when they have access to the current editor state. Users were manually copying code, file paths, and cursor positions into prompts. This was tedious and error-prone, especially for multi-file operations.

The ACP protocol supports editor context as part of the prompt, but it wasn't being leveraged.

## Decision
Implemented `EditorContext` module to automatically capture:
- Current file path and content
- Cursor position (line, character)
- Selected text
- Language ID
- Open editors list

Added `acp.editorContextLinked` setting (default: false) to toggle automatic context injection.

When enabled, context is prepended to user prompts with clear visual separation.

## Consequences
**Positive**: 
- Agents can reference exact code without user copy-paste
- Faster workflow for code-related questions
- Context includes unsaved buffer changes

**Negative**:
- Privacy concern: full file content may be sent to agents
- Performance: capturing large files can be slow
- Requires user opt-in to avoid surprises

## Alternatives Considered
- Manual context insertion via command palette - rejected for poor UX
- Always-on context - rejected for privacy reasons
- Per-agent toggle - may be added later
