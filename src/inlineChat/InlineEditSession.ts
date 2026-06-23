import * as vscode from 'vscode';

import { isRunAbortedError } from '../core/RunAbortedError';
import { InlineEditAgent } from './agent/InlineEditAgent';
import { InlineChatMessage, InlineChatResponse, InlineEditRequest, InlineEditResult } from './InlineChatTypes';
import {
  decidePatchAcceptance,
  type PatchProposal,
  proposePatch,
} from './patch/PatchDecision';

export interface InlineEditSessionHost {
  post(message: InlineChatResponse): Promise<void>;
  close(): void;
  showWarning(message: string): void;
  showError(message: string): void;
}

export class InlineEditSession implements vscode.Disposable {
  private pendingProposal?: PatchProposal;
  private activeRun?: AbortController;
  private readonly documentVersion: number;

  constructor(
    private readonly editor: vscode.TextEditor,
    private readonly agent: InlineEditAgent,
    private readonly host: InlineEditSessionHost,
  ) {
    this.documentVersion = editor.document.version;
  }

  async handleMessage(message: InlineChatMessage): Promise<void> {
    switch (message.type) {
      case 'submit':
        await this.submit(message.prompt);
        break;
      case 'accept':
        await this.accept();
        break;
      case 'reject':
        this.reject();
        break;
      case 'stop':
        await this.stop();
        break;
      case 'cancel':
        this.cancel();
        break;
      default: {
        const unknownType = (message as { type?: string }).type ?? 'unknown';
        console.warn(`InlineEditSession: ignored message type "${unknownType}"`);
      }
    }
  }

  dispose(): void {
    this.abortActiveRun();
    this.pendingProposal = undefined;
  }

  private async submit(prompt: string): Promise<void> {
    const document = this.editor.document;
    const selection = this.editor.selection;

    this.activeRun?.abort();
    const runController = new AbortController();
    this.activeRun = runController;

    await this.host.post({
      type: 'status',
      value: 'thinking',
      agent: await this.resolveAgentDisplayName(),
    });

    try {
      const request: InlineEditRequest = {
        prompt,
        uri: document.uri.toString(),
        languageId: document.languageId,
        fileName: document.fileName,
        selection,
        selectedText: document.getText(selection),
        contextText: this.getContextText(document, selection.active.line),
      };

      const result: InlineEditResult = await this.agent.generateEdit(request, {
        signal: runController.signal,
      });

      if (runController.signal.aborted) {
        return;
      }

      this.pendingProposal = proposePatch(result, this.documentVersion);

      await this.host.post({
        type: 'proposal',
        summary: result.summary,
        editsCount: result.edits.length,
      });
    } catch (error) {
      if (isRunAbortedError(error) || runController.signal.aborted) {
        return;
      }
      console.error('Error generating edit:', error);
      await this.host.post({ type: 'status', value: 'error' });
      this.host.showError(`Error generating edit: ${error}`);
    } finally {
      if (this.activeRun === runController) {
        this.activeRun = undefined;
      }
    }
  }

  private async accept(): Promise<void> {
    if (!this.pendingProposal) {
      return;
    }

    const outcome = await decidePatchAcceptance(this.editor, this.pendingProposal);

    switch (outcome.kind) {
      case 'empty':
        return;
      case 'stale':
        this.host.showWarning(
          'The document changed since the inline proposal was generated. ' +
          'Please retry the inline chat.',
        );
        return;
      case 'failed':
        console.error('Error applying edits:', outcome.message);
        this.host.showError(outcome.message);
        return;
      case 'applied':
        this.pendingProposal = undefined;
        this.host.close();
        return;
    }
  }

  private reject(): void {
    this.abortActiveRun();
    this.host.close();
  }

  private async stop(): Promise<void> {
    this.abortActiveRun();
    await this.host.post({ type: 'status', value: 'ready' });
  }

  private cancel(): void {
    this.abortActiveRun();
    this.host.close();
  }

  private async resolveAgentDisplayName(): Promise<string> {
    let agentName = 'Damien';
    try {
      const display = this.agent.getDisplayName?.();
      agentName = display instanceof Promise ? await display : (display ?? agentName);
    } catch {
      // Use the default label when an agent adapter cannot report a name.
    }
    return agentName;
  }

  private getContextText(document: vscode.TextDocument, line: number): string {
    const before = Math.max(0, line - 80);
    const after = Math.min(document.lineCount - 1, line + 80);

    const range = new vscode.Range(
      new vscode.Position(before, 0),
      document.lineAt(after).range.end,
    );

    return document.getText(range);
  }

  private abortActiveRun(): void {
    this.activeRun?.abort();
    this.activeRun = undefined;
  }
}
