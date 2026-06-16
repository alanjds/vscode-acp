import * as vscode from 'vscode';
import { getInlineChatHtml } from './webview/inlineChatHtml';
import { InlineEditAgent } from './agent/InlineEditAgent';
import { PatchApplyService } from './patch/PatchApplyService';
import { InlineChatMessage, InlineChatResponse, InlineEditRequest, InlineEditResult } from './InlineChatTypes';

// Import the proposed API types
// This will be available when running in VS Code Insiders with enabled proposed APIs
interface WebviewEditorInset {
  editor: vscode.TextEditor;
  line: number;
  height: number;
  webview: vscode.Webview;
  onDidDispose: vscode.Event<void>;
  dispose(): void;
}

/**
 * Inline chat inset that appears between editor lines
 * Uses the proposed editorInsets API
 */
export class InlineChatInset implements vscode.Disposable {
  private inset?: WebviewEditorInset;
  private disposables: vscode.Disposable[] = [];
  private pendingEdits?: vscode.TextEdit[];
  private readonly documentVersion: number;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly editor: vscode.TextEditor,
    private readonly agent: InlineEditAgent,
    private readonly patchApplyService: PatchApplyService
  ) {
    this.documentVersion = editor.document.version;
  }

  /**
   * Show the inline chat inset below the current line
   */
  async show(): Promise<void> {
    const line = this.editor.selection.active.line + 1;

    // Create the webview inset using the proposed API
    // Note: This API is only available in VS Code Insiders with proposed APIs enabled
    try {
      this.inset = this.createWebviewInset(this.editor, line, 8, {
        enableScripts: true,
        localResourceRoots: [this.context.extensionUri]
      });

      this.inset.webview.html = getInlineChatHtml(this.inset.webview);

      // Set up message handling
      this.setupMessageHandling();

      // Set up event listeners for cleanup
      this.setupEventListeners();

    } catch (error) {
      console.error('Failed to create webview inset:', error);
      vscode.window.showErrorMessage(
        'Failed to create inline chat: editorInsets API may not be available. ' +
        'Please use VS Code Insiders with proposed APIs enabled.'
      );
      this.dispose();
    }
  }

  /**
   * Create a webview text editor inset
   * This uses the proposed API which may change or be removed
   */
  private createWebviewInset(
    editor: vscode.TextEditor,
    line: number,
    height: number,
    options?: vscode.WebviewOptions
  ): WebviewEditorInset {
    // Check if the API is available
    if (typeof (vscode.window as any).createWebviewTextEditorInset === 'function') {
      return (vscode.window as any).createWebviewTextEditorInset(
        editor,
        line,
        height,
        options
      );
    }
    
    // Fallback for testing - in production this should not be called
    throw new Error('createWebviewTextEditorInset is not available');
  }

  /**
   * Set up message handling between webview and extension
   */
  private setupMessageHandling(): void {
    if (!this.inset) return;

    this.disposables.push(
      this.inset.webview.onDidReceiveMessage(async (message: InlineChatMessage) => {
        switch (message.type) {
          case 'submit':
            await this.handleSubmit(message.prompt);
            break;
          case 'accept':
            await this.accept();
            break;
          case 'reject':
          case 'cancel':
            this.dispose();
            break;
        }
      })
    );
  }

  /**
   * Set up event listeners for cleanup
   */
  private setupEventListeners(): void {
    // Close inset when active editor changes
    this.disposables.push(
      vscode.window.onDidChangeActiveTextEditor(activeEditor => {
        if (activeEditor !== this.editor) {
          this.dispose();
        }
      })
    );

    // Close inset when document is closed
    this.disposables.push(
      vscode.workspace.onDidCloseTextDocument(document => {
        if (document.uri.toString() === this.editor.document.uri.toString()) {
          this.dispose();
        }
      })
    );

    // Close inset when document content changes significantly
    this.disposables.push(
      vscode.workspace.onDidChangeTextDocument(event => {
        if (event.document.uri.toString() === this.editor.document.uri.toString()) {
          // Only dispose if the change is significant (not just cursor movement)
          if (event.contentChanges.length > 0) {
            // For now, we'll keep the inset open but we could add logic to close it
            // if the changes are too significant
          }
        }
      })
    );
  }

  /**
   * Handle prompt submission from user
   */
  private async handleSubmit(prompt: string): Promise<void> {
    const document = this.editor.document;
    const selection = this.editor.selection;

    // Post thinking status including agent display name (if available)
    let agentName = 'Damien';
    try {
      const display = (this.agent as any).getDisplayName?.();
      agentName = display instanceof Promise ? await display : (display ?? agentName);
    } catch {
      // ignore and fallback to default
    }

    await this.post({ type: 'status', value: 'thinking', agent: agentName } as InlineChatResponse);

    try {
      const selectedText = document.getText(selection);
      const contextText = this.getContextText(document, selection.active.line);

      // Create request for the agent
      const request: InlineEditRequest = {
        prompt,
        uri: document.uri.toString(),
        languageId: document.languageId,
        fileName: document.fileName,
        selection,
        selectedText,
        contextText
      };

      // Get edit proposal from agent
      const result: InlineEditResult = await this.agent.generateEdit(request);

      // Convert to VS Code text edits
      this.pendingEdits = result.edits.map((edit: InlineEditResult['edits'][number]) =>
        new vscode.TextEdit(
          new vscode.Range(
            new vscode.Position(edit.range.start.line, edit.range.start.character),
            new vscode.Position(edit.range.end.line, edit.range.end.character)
          ),
          edit.newText
        )
      );

      await this.post({
        type: 'proposal',
        summary: result.summary,
        editsCount: result.edits.length
      } as InlineChatResponse);

    } catch (error) {
      console.error('Error generating edit:', error);
      await this.post({ type: 'status', value: 'error' } as InlineChatResponse);
      vscode.window.showErrorMessage(`Error generating edit: ${error}`);
    }
  }

  /**
   * Accept the current proposal and apply edits
   */
  private async accept(): Promise<void> {
    if (!this.pendingEdits?.length) {
      return;
    }

    // Check if document has changed since proposal was generated
    if (this.editor.document.version !== this.documentVersion) {
      vscode.window.showWarningMessage(
        'The document changed since the inline proposal was generated. ' +
        'Please retry the inline chat.'
      );
      return;
    }

    try {
      // Apply the edits
      const success = await this.patchApplyService.apply(
        this.editor,
        this.pendingEdits
      );

      if (success) {
        // Clear pending edits
        this.pendingEdits = undefined;
        // Close the inset
        this.dispose();
      } else {
        vscode.window.showErrorMessage('Failed to apply edits');
      }
    } catch (error) {
      console.error('Error applying edits:', error);
      vscode.window.showErrorMessage(`Error applying edits: ${error}`);
    }
  }

  /**
   * Get context text around the current line
   */
  private getContextText(document: vscode.TextDocument, line: number): string {
    const before = Math.max(0, line - 80);
    const after = Math.min(document.lineCount - 1, line + 80);

    const range = new vscode.Range(
      new vscode.Position(before, 0),
      document.lineAt(after).range.end
    );

    return document.getText(range);
  }

  /**
   * Send message to webview
   */
  private async post(message: InlineChatResponse): Promise<void> {
    await this.inset?.webview.postMessage(message);
  }

  /**
   * Dispose of the inset and clean up resources
   */
  dispose(): void {
    this.inset?.dispose();
    this.inset = undefined;

    for (const disposable of this.disposables) {
      disposable.dispose();
    }
    this.disposables = [];

    this.pendingEdits = undefined;
  }
}
