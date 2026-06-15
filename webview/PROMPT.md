# Prompt Input - Markdown + HTMX Specification

## Overview

This document describes the Markdown-compatible prompt input area with HTMX-enhanced file mentions for the ACP chat interface.

## File Mention Format

File mentions use Markdown link syntax with a custom `file://` URI scheme:

```markdown
[@filename](file://path/to/file)
```

### Examples

- Simple file: `[@package.json](file://package.json)`
- Nested file: `[@config.yml](file://config/app.yml)`
- File with spaces: `[@readme file.md](file://docs/readme%20file.md)`

## HTMX Integration

File mentions are rendered as interactive chips in the input area. The chips use HTMX attributes for interactivity:

```html
<span 
  class="prompt-file-mention" 
  hx-on:click="openFile('path/to/file')"
  data-file-path="path/to/file"
>
  @filename
</span>
```

### HTMX Attributes

| Attribute | Purpose | Example |
|-----------|---------|---------|
| `hx-on:click` | Triggers file opening on click | `hx-on:click="openFile('path/to/file')"` |
| `data-file-path` | Stores the actual file path | `data-file-path="path/to/file"` |
| `data-file-name` | Stores the display name | `data-file-name="filename"` |

## Implementation Details

### 1. Input Storage

The underlying input stores text in plain Markdown format:
```
"Check this file: [@package.json](file://package.json)"
```

### 2. Rendering

When displayed in the `contentEditable` div, mentions are transformed to interactive HTML:

```html
<div contentEditable="true">
  Check this file: 
  <span class="prompt-file-mention" 
        hx-on:click="openFile('package.json')"
        data-file-path="package.json"
        data-file-name="package.json">
    @package.json
  </span>
</div>
```

### 3. Agent Prompt Expansion

Before sending to the agent, Markdown mentions are expanded to the format the agent expects:

**Input:**
```
"Check [@package.json](file://package.json)"
```

**Expanded to Agent:**
```
"Check @package.json"
```

### 4. Insertion Behavior

When a user types `@` and selects a file from the popup:
1. The selection triggers `replaceActiveFileMention()`
2. A Markdown link is inserted at the cursor position
3. The mention is immediately rendered as an interactive chip
4. The original token format `@filename` is replaced with `[@filename](file://path)`

## CSS Classes

```css
/* Base mention chip */
.prompt-file-mention {
  display: inline-flex;
  align-items: center;
  background: var(--vscode-badge-background);
  color: var(--vscode-badge-foreground);
  border-radius: 4px;
  padding: 2px 6px;
  font-size: 0.9em;
  cursor: pointer;
  white-space: nowrap;
}

/* Hover state */
.prompt-file-mention:hover {
  background: var(--vscode-badge-hoverBackground);
}

/* Icon styling */
.prompt-file-mention::before {
  content: "@";
  margin-right: 2px;
  opacity: 0.7;
}
```

## Message Flow

### File Click in Webview

1. User clicks on a file mention chip
2. HTMX `hx-on:click` triggers custom JavaScript handler
3. Webview posts `openFile` message to extension:
   ```json
   {
     "type": "openFile",
     "path": "path/to/file"
   }
   ```
4. Extension resolves the file URI and opens it in VS Code

### Insertion Flow

1. User types `@` in input area
2. File popup appears with matching files
3. User selects a file
4. Webview inserts Markdown link: `[@filename](file://path)`
5. Input re-renders with interactive chip
6. `selectedFileMentions` array is updated with:
   ```json
   {
     "path": "path/to/file",
     "name": "filename",
     "token": "[@filename](file://path/to/file)"
   }
   ```

## Backward Compatibility

The system maintains backward compatibility with the existing `@filename` format:

- **Old format:** `@filename` (plain text)
- **New format:** `[@filename](file://path)` (Markdown link)

Both formats are:
- Accepted when typing/selecting files
- Properly expanded for the agent
- Filtered from `selectedFileMentions` when deleted

## Testing Scenarios

1. **Typing @ and selecting file**: Should insert Markdown link and render as chip
2. **Clicking mention chip**: Should open the file in VS Code
3. **Deleting mention**: Should remove entire Markdown link as a single unit
4. **Multiple mentions**: Should handle multiple file mentions correctly
5. **Markdown in prompt**: Should preserve other Markdown syntax (bold, italic, etc.)
6. **Agent receives correct format**: Should expand to `@path` format for agent
7. **Special characters in path**: Should handle spaces, special chars correctly with URL encoding
