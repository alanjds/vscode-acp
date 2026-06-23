import * as assert from 'assert';
import * as vscode from 'vscode';

import {
  decidePatchAcceptance,
  isPatchStale,
  proposePatch,
  type PatchProposal,
} from '../inlineChat/patch/PatchDecision';
import type { InlineEditResult } from '../inlineChat/InlineChatTypes';

function createMockEditor(options: {
  version: number;
  applyResult?: boolean;
  applyError?: Error;
}): vscode.TextEditor {
  const document = {
    version: options.version,
  } as vscode.TextDocument;

  return {
    document,
    edit: async () => {
      if (options.applyError) {
        throw options.applyError;
      }
      return options.applyResult ?? true;
    },
  } as unknown as vscode.TextEditor;
}

const editResult: InlineEditResult = {
  summary: 'Rename variable',
  edits: [{
    range: {
      start: { line: 1, character: 0 },
      end: { line: 1, character: 3 },
    },
    newText: 'foo',
  }],
};

suite('PatchDecision', () => {
  test('proposePatch binds document version and maps edits', () => {
    const proposal = proposePatch(editResult, 7);

    assert.strictEqual(proposal.summary, 'Rename variable');
    assert.strictEqual(proposal.documentVersion, 7);
    assert.strictEqual(proposal.edits.length, 1);
    assert.strictEqual(proposal.edits[0]?.newText, 'foo');
    assert.strictEqual(proposal.edits[0]?.range.start.line, 1);
  });

  test('isPatchStale detects version drift', () => {
    const proposal = proposePatch(editResult, 3);
    assert.strictEqual(isPatchStale(proposal, 3), false);
    assert.strictEqual(isPatchStale(proposal, 4), true);
  });

  test('decidePatchAcceptance returns empty when proposal has no edits', async () => {
    const proposal: PatchProposal = {
      summary: 'noop',
      documentVersion: 1,
      edits: [],
    };

    const outcome = await decidePatchAcceptance(createMockEditor({ version: 1 }), proposal);
    assert.strictEqual(outcome.kind, 'empty');
  });

  test('decidePatchAcceptance returns stale when document changed', async () => {
    const proposal = proposePatch(editResult, 2);
    const outcome = await decidePatchAcceptance(createMockEditor({ version: 3 }), proposal);
    assert.strictEqual(outcome.kind, 'stale');
  });

  test('decidePatchAcceptance returns applied on successful edit', async () => {
    const proposal = proposePatch(editResult, 1);
    const outcome = await decidePatchAcceptance(createMockEditor({ version: 1 }), proposal);
    assert.strictEqual(outcome.kind, 'applied');
  });

  test('decidePatchAcceptance returns failed when editor.edit returns false', async () => {
    const proposal = proposePatch(editResult, 1);
    const outcome = await decidePatchAcceptance(
      createMockEditor({ version: 1, applyResult: false }),
      proposal,
    );
    assert.strictEqual(outcome.kind, 'failed');
    if (outcome.kind === 'failed') {
      assert.match(outcome.message, /Failed to apply edits/);
    }
  });

  test('decidePatchAcceptance returns failed when editor.edit throws', async () => {
    const proposal = proposePatch(editResult, 1);
    const outcome = await decidePatchAcceptance(
      createMockEditor({ version: 1, applyError: new Error('boom') }),
      proposal,
    );
    assert.strictEqual(outcome.kind, 'failed');
    if (outcome.kind === 'failed') {
      assert.match(outcome.message, /boom/);
    }
  });
});
