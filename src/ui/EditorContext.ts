import * as vscode from 'vscode';

/**
 * Captures the current editor context (active file, cursor, selection, open tabs)
 * and formats it as a text prefix to prepend to chat prompts.
 */
export function captureEditorContext(): string | null {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    return null;
  }

  const doc = editor.document;
  const filePath = doc.fileName;
  const selection = editor.selection;

  const lines: string[] = [];
  lines.push(`Active file: ${filePath}`);
  lines.push(`Cursor: line ${selection.active.line + 1}, column ${selection.active.character + 1}`);

  if (!selection.isEmpty) {
    const selectedText = doc.getText(selection);
    lines.push(`Selected text:\n\`\`\`\n${selectedText}\n\`\`\``);
  } else {
    const currentLine = doc.lineAt(selection.active.line).text;
    lines.push(`Current line: ${currentLine}`);
  }

  const openFiles = [...new Set(
    vscode.window.tabGroups.all
      .flatMap(g => g.tabs)
      .map(t => (t.input as any)?.uri?.fsPath)
      .filter((p): p is string => !!p && p !== filePath)
  )];

  if (openFiles.length > 0) {
    lines.push(`Open files:\n${openFiles.map(p => `  - ${p}`).join('\n')}`);
  }

  return `[Editor Context]\n${lines.join('\n')}\n\n`;
}
