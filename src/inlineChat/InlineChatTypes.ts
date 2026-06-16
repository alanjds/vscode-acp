import * as vscode from 'vscode';

/**
 * Request sent to the inline edit agent
 */
export interface InlineEditRequest {
  prompt: string;
  uri: string;
  languageId: string;
  fileName: string;
  selection: vscode.Selection;
  selectedText: string;
  contextText: string;
}

/**
 * Result from the inline edit agent
 */
export interface InlineEditResult {
  summary: string;
  edits: Array<{
    range: {
      start: { line: number; character: number };
      end: { line: number; character: number };
    };
    newText: string;
  }>;
}

/**
 * Message types for webview communication
 */
export type InlineChatMessage = 
  | { type: 'submit'; prompt: string }
  | { type: 'accept' }
  | { type: 'reject' }
  | { type: 'stop' }
  | { type: 'cancel' };

/**
 * Webview message types from extension to webview
 */
export type InlineChatResponse = 
  | { type: 'status'; value: 'thinking' | 'ready' | 'error'; agent?: string }
  | { type: 'proposal'; summary: string; editsCount: number };
