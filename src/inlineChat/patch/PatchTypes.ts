import * as vscode from 'vscode';

/**
 * Represents a text edit to be applied
 */
export interface PatchEdit {
  range: vscode.Range;
  newText: string;
}

/**
 * Represents a complete patch with multiple edits
 */
export interface Patch {
  edits: PatchEdit[];
  summary: string;
  timestamp: number;
}

/**
 * Result of applying a patch
 */
export interface PatchResult {
  success: boolean;
  appliedEdits: number;
  error?: string;
}
