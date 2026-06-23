import * as vscode from 'vscode';

import type { InlineEditResult } from '../InlineChatTypes';

export interface PatchProposal {
  edits: vscode.TextEdit[];
  summary: string;
  documentVersion: number;
}

export type PatchDecisionOutcome =
  | { kind: 'applied' }
  | { kind: 'stale' }
  | { kind: 'failed'; message: string }
  | { kind: 'empty' };

/**
 * Builds a Patch from an EditProposal, bound to the document version at proposal time.
 */
export function proposePatch(result: InlineEditResult, documentVersion: number): PatchProposal {
  return {
    summary: result.summary,
    documentVersion,
    edits: result.edits.map(edit =>
      new vscode.TextEdit(
        new vscode.Range(
          new vscode.Position(edit.range.start.line, edit.range.start.character),
          new vscode.Position(edit.range.end.line, edit.range.end.character),
        ),
        edit.newText,
      ),
    ),
  };
}

export function isPatchStale(proposal: PatchProposal, currentDocumentVersion: number): boolean {
  return currentDocumentVersion !== proposal.documentVersion;
}

/**
 * Applies a Patch when the document version still matches. Returns a PatchDecision outcome
 * instead of throwing or showing UI — callers own presentation.
 */
export async function decidePatchAcceptance(
  editor: vscode.TextEditor,
  proposal: PatchProposal,
): Promise<PatchDecisionOutcome> {
  if (!proposal.edits.length) {
    return { kind: 'empty' };
  }

  if (isPatchStale(proposal, editor.document.version)) {
    return { kind: 'stale' };
  }

  try {
    const success = await editor.edit(
      editBuilder => {
        for (const edit of proposal.edits) {
          editBuilder.replace(edit.range, edit.newText);
        }
      },
      {
        undoStopBefore: true,
        undoStopAfter: true,
      },
    );

    return success ? { kind: 'applied' } : { kind: 'failed', message: 'Failed to apply edits' };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { kind: 'failed', message: `Error applying edits: ${message}` };
  }
}
