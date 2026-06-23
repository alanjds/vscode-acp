import * as vscode from 'vscode';
import { getInlineChatHtml } from './webview/inlineChatHtml';
import { InlineEditAgent } from './agent/InlineEditAgent';
import { InlineChatMessage, InlineChatResponse } from './InlineChatTypes';
import { InlineEditSession } from './InlineEditSession';

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
  private readonly session: InlineEditSession;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly editor: vscode.TextEditor,
    agent: InlineEditAgent,
  ) {
    this.session = new InlineEditSession(editor, agent, {
      post: message => this.post(message),
      close: () => this.dispose(),
      showWarning: message => { void vscode.window.showWarningMessage(message); },
      showError: message => { void vscode.window.showErrorMessage(message); },
    });
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
    if (!this.inset) {
      return;
    }

    this.disposables.push(
      this.inset.webview.onDidReceiveMessage(async (message: InlineChatMessage) => {
        await this.session.handleMessage(message);
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
   * Send message to webview
   */
  private async post(message: InlineChatResponse): Promise<void> {
    await this.inset?.webview.postMessage(message);
  }

  /**
   * Dispose of the inset and clean up resources
   */
  dispose(): void {
    this.session.dispose();
    this.inset?.dispose();
    this.inset = undefined;

    for (const disposable of this.disposables) {
      disposable.dispose();
    }
    this.disposables = [];
  }
}
