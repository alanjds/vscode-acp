import * as vscode from 'vscode';
import { InlineChatInset } from './InlineChatInset';
import { InlineEditAgent } from './agent/InlineEditAgent';
/**
 * Controller for managing inline chat sessions
 */
export class InlineChatController implements vscode.Disposable {
  private currentInset?: InlineChatInset;
  private disposables: vscode.Disposable[] = [];

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly agent: InlineEditAgent,
  ) {}

  /**
   * Open inline chat at current cursor position
   */
  async open(): Promise<void> {
    const editor = vscode.window.activeTextEditor;

    if (!editor) {
      vscode.window.showWarningMessage('No active editor.');
      return;
    }

    // Dispose of any existing inset
    this.currentInset?.dispose();

    // Create new inset
    this.currentInset = new InlineChatInset(
      this.context,
      editor,
      this.agent,
    );

    await this.currentInset.show();
  }

  /**
   * Toggle inline chat
   */
  async toggle(): Promise<void> {
    if (this.currentInset) {
      this.currentInset.dispose();
      this.currentInset = undefined;
    } else {
      await this.open();
    }
  }

  /**
   * Close current inline chat
   */
  close(): void {
    this.currentInset?.dispose();
    this.currentInset = undefined;
  }

  dispose(): void {
    this.close();
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
    this.disposables = [];
  }
}
