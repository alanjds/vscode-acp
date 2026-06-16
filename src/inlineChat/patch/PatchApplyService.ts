import * as vscode from 'vscode';
import { PatchEdit, PatchResult } from './PatchTypes';

/**
 * Service for applying patches to documents
 */
export class PatchApplyService {
  /**
   * Apply a set of text edits to the current document
   */
  async apply(
    editor: vscode.TextEditor,
    edits: vscode.TextEdit[]
  ): Promise<boolean> {
    return editor.edit(
      editBuilder => {
        for (const edit of edits) {
          editBuilder.replace(edit.range, edit.newText);
        }
      },
      {
        undoStopBefore: true,
        undoStopAfter: true
      }
    );
  }

  /**
   * Apply a patch with validation
   */
  async applyWithValidation(
    editor: vscode.TextEditor,
    patchEdits: PatchEdit[]
  ): Promise<PatchResult> {
    try {
      const edits = patchEdits.map(edit => 
        new vscode.TextEdit(edit.range, edit.newText)
      );
      
      const success = await this.apply(editor, edits);
      
      return {
        success,
        appliedEdits: edits.length,
        error: success ? undefined : 'Failed to apply edits'
      };
    } catch (error) {
      return {
        success: false,
        appliedEdits: 0,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }
}
