import * as path from 'path';
import * as vscode from 'vscode';

export type EditorSelectionContext = {
  startLine: number;
  startCharacter: number;
  endLine: number;
  endCharacter: number;
  text: string;
};

export type EditorLineContext = {
  line: number;
  text: string;
};

export type OpenEditorFile = {
  path: string;
  openedAt: number;
};

export type EditorContext = {
  filePath: string;
  cursorLine: number;
  cursorCharacter: number;
  language: string;
  selection: EditorSelectionContext | null;
  currentLine: EditorLineContext | null;
  openEditors: OpenEditorFile[];
};

export type EditorContextPathFormatter = (filePath: string) => string;

// Global tracker for currently open editor files.
const openEditorOpenedAtByPath = new Map<string, number>();

// Maximum number of open editors to include in context.
export const MAX_OPEN_EDITORS = 5;

// Maximum context text length to prevent token overflow
export const MAX_CONTEXT_LENGTH = 5000;

const TRUNCATION_SUFFIX = '… [truncated]';

function truncateText(text: string, maxLength: number): string {
  if (maxLength <= 0) {
    return '';
  }
  if (text.length <= maxLength) {
    return text;
  }
  if (maxLength <= TRUNCATION_SUFFIX.length) {
    return text.slice(0, maxLength);
  }
  const truncatedTextLength = maxLength - TRUNCATION_SUFFIX.length;
  return text.slice(0, truncatedTextLength) + TRUNCATION_SUFFIX;
}

function getBoundedSelectionText(
  document: vscode.TextDocument,
  selection: vscode.Selection,
  maxLength: number,
): string {
  let text = '';

  for (let lineNumber = selection.start.line; lineNumber <= selection.end.line; lineNumber++) {
    const lineText = document.lineAt(lineNumber).text;
    const startCharacter = lineNumber === selection.start.line ? selection.start.character : 0;
    const endCharacter = lineNumber === selection.end.line ? selection.end.character : lineText.length;
    const segment = `${lineNumber === selection.start.line ? '' : '\n'}${lineText.slice(startCharacter, endCharacter)}`;

    if (text.length + segment.length > maxLength) {
      const boundedSegment = segment.slice(0, maxLength - text.length + 1);
      return truncateText(text + boundedSegment, maxLength);
    }

    text += segment;
  }

  return text;
}

// Initialize tracker with VS Code document events.
export function initializeOpenEditorsTracker(): vscode.Disposable[] {
  const openDocDisposable = vscode.workspace.onDidOpenTextDocument(doc => {
    if (doc.uri.scheme === 'file') {
      openEditorOpenedAtByPath.set(doc.uri.fsPath, Date.now());
    }
  });

  const closeDocDisposable = vscode.workspace.onDidCloseTextDocument(doc => {
    if (doc.uri.scheme === 'file') {
      openEditorOpenedAtByPath.delete(doc.uri.fsPath);
    }
  });

  return [openDocDisposable, closeDocDisposable];
}

export function captureEditorContext(
  editor: vscode.TextEditor | undefined,
  openEditors: OpenEditorFile[] = [],
): EditorContext | null {
  if (!editor?.document?.uri) {
    return null;
  }

  const { document, selection } = editor;

  return {
    filePath: document.uri.fsPath,
    cursorLine: selection.active.line + 1,
    cursorCharacter: selection.active.character + 1,
    language: getMarkdownLanguage(document.uri.fsPath, document.languageId),
    selection: selection.isEmpty
      ? null
      : {
          startLine: selection.start.line + 1,
          startCharacter: selection.start.character + 1,
          endLine: selection.end.line + 1,
          endCharacter: selection.end.character + 1,
          text: getBoundedSelectionText(document, selection, MAX_CONTEXT_LENGTH),
        },
    currentLine: selection.isEmpty
      ? {
          line: selection.active.line + 1,
          text: truncateText(document.lineAt(selection.active.line).text, MAX_CONTEXT_LENGTH),
        }
      : null,
    openEditors: normalizeOpenEditorPaths(openEditors),
  };
}

export function captureOpenEditorPaths(tabGroups: readonly vscode.TabGroup[]): OpenEditorFile[] {
  const files: OpenEditorFile[] = [];

  for (const group of tabGroups) {
    for (const tab of group.tabs) {
      if (tab.input instanceof vscode.TabInputText && tab.input.uri.scheme === 'file') {
        const fsPath = tab.input.uri.fsPath;
        let openedAt = openEditorOpenedAtByPath.get(fsPath);
        if (openedAt === undefined) {
          openedAt = Date.now();
          openEditorOpenedAtByPath.set(fsPath, openedAt);
        }
        files.push({
          path: fsPath,
          openedAt,
        });
      }
    }
  }

  return normalizeOpenEditorPaths(files);
}

export function normalizeOpenEditorPaths(files: readonly OpenEditorFile[]): OpenEditorFile[] {
  const fileMap = new Map<string, OpenEditorFile>();

  for (const file of files) {
    if (!file.path) {
      continue;
    }

    const normalizedPath = path.normalize(file.path);
    // Keep case-sensitive keys even on case-insensitive filesystems. This can
    // leave duplicate entries when the same file is opened with different
    // casing.
    const canonicalKey = normalizedPath;
    const existing = fileMap.get(canonicalKey);

    if (!existing || file.openedAt > existing.openedAt) {
      fileMap.set(canonicalKey, {
        ...file,
        path: normalizedPath,
      });
    }
  }

  return Array.from(fileMap.values())
    .sort((a, b) => b.openedAt - a.openedAt)
    .slice(0, MAX_OPEN_EDITORS);
}

export function getSafeFenceMarker(contextText: string): string {
  let fence = '```';
  while (contextText.includes(fence)) {
    fence += '`';
  }
  return fence;
}

const workspacePathFormatter: EditorContextPathFormatter = filePath => {
  return vscode.workspace.workspaceFolders?.length
    ? vscode.workspace.asRelativePath(filePath)
    : filePath;
};

export function buildEditorContextSection(
  context: EditorContext | null,
  formatPath: EditorContextPathFormatter = workspacePathFormatter,
): string {
  if (!context) {
    return '';
  }

  const locationLine = context.selection
    ? `Selection: ${context.selection.startLine}:${context.selection.startCharacter}-${context.selection.endLine}:${context.selection.endCharacter}`
    : `Line: ${context.currentLine?.line ?? context.cursorLine}`;
  const contextText = context.selection?.text ?? context.currentLine?.text ?? '';
  const fence = getSafeFenceMarker(contextText);
  const displayPath = formatPath(context.filePath);

  const lines = [
    'VS Code context:',
    `File: ${displayPath}`,
    `Cursor: ${context.cursorLine}:${context.cursorCharacter}`,
    locationLine,
    '',
    `${fence}${context.language}`,
    contextText,
    fence,
  ];

  if (context.openEditors.length > 0) {
    const relativeEditors = context.openEditors.map(file => formatPath(file.path));
    lines.push('', 'Open editors:', ...relativeEditors.map(filePath => `- ${filePath}`));
  }

  return lines.join('\n');
}

export function buildPromptWithEditorContext(prompt: string, context: EditorContext | null): string {
  const contextSection = buildEditorContextSection(context);
  if (!contextSection) {
    return prompt;
  }

  return `${contextSection}\n\nUser prompt:\n${prompt}`;
}

function getMarkdownLanguage(filePath: string, languageId: string): string {
  const extension = path.extname(filePath).replace(/^\./, '');
  return extension || languageId || '';
}
