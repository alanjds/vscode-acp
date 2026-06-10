# ADR-0004: File Mentions for Prompt Context

**Status**: Accepted

## Context
The previous file attachment workflow used a toolbar command and a native file picker. This created a separate interaction path from the chat input, added UI noise, and inserted file context in a format that was harder to edit inline.

Users need a fast way to reference workspace files while writing a prompt. The reference should be readable in the prompt, clickable in the UI, and unambiguous for the agent.

## Decision
Replaced the attach-file command with file mentions in the chat composer:

- Typing `@` in the prompt opens a webview popup with workspace file search results.
- File search is handled by the extension host with `vscode.workspace.findFiles`, not by direct filesystem access from the webview.
- Selecting a result inserts a visible `@filename` mention followed by a space.
- The composer uses a `contenteditable` input so selected file mentions can render as clickable inline elements.
- Clicking a file mention sends an `openFile` message to the extension host, which opens the target file in VS Code.
- The webview keeps selected mention metadata `{ name, path, token }`.
- Before sending a prompt to the agent, visible `@filename` tokens are expanded to `@relative/path/to/file` so the agent receives an unambiguous file reference.

The old `acp.attachFile` command, toolbar icon, menu item, and `file-attached` webview message were removed.

## Consequences
**Positive**:
- File references are inserted directly where the user is typing
- UI stays readable by showing short filenames
- Agent prompts remain precise by using relative paths on send
- Clickable mentions let users quickly open the referenced file
- Removes the obsolete paperclip toolbar action

**Negative**:
- `contenteditable` requires custom cursor and text synchronization logic
- Duplicate filenames need internal metadata to preserve the selected target path
- The webview must keep mention text and mention metadata in sync when users edit or delete tokens

## Alternatives Considered
- Keep the native attach-file command - rejected because it is separate from prompt composition and duplicates the `@` workflow
- Show full relative paths in the prompt - rejected because it makes prompts noisy
- Use a `textarea` with a visual overlay - rejected because links inside the prompt are not truly clickable/editable text
- Send only filenames to agents - rejected because duplicate filenames are ambiguous
