import * as vscode from 'vscode';

import { ChatWebviewController } from './ChatWebviewController';

/**
 * WebviewViewProvider adapter for the ACP chat sidebar.
 * Delegates behavior to {@link ChatWebviewController}.
 */
export class ChatWebviewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'acp-chat';

  private view?: vscode.WebviewView;
  private attachDisposable?: vscode.Disposable;
  private readonly endpointId: string;

  constructor(private readonly controller: ChatWebviewController) {
    this.endpointId = controller.createEndpointId('view');
  }

  async resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ): Promise<void> {
    this.view = webviewView;
    webviewView.webview.options = this.controller.getWebviewOptions();

    this.attachDisposable?.dispose();
    this.attachDisposable = this.controller.attachWebview({
      id: this.endpointId,
      kind: 'view',
      webview: webviewView.webview,
    });

    webviewView.onDidDispose(() => {
      this.attachDisposable?.dispose();
      this.attachDisposable = undefined;
      this.view = undefined;
    });

    webviewView.webview.html = await this.controller.getHtmlContent(webviewView.webview);
  }

  notifyActiveSessionChanged(): void {
    this.controller.notifyActiveSessionChanged();
  }

  notifyModesUpdate(modes: unknown): void {
    this.controller.notifyModesUpdate(modes);
  }

  notifyModelsUpdate(models: unknown): void {
    this.controller.notifyModelsUpdate(models);
  }

  notifyConfigOptionsUpdate(configOptions: unknown): void {
    this.controller.notifyConfigOptionsUpdate(configOptions);
  }

  notifyLoadSessionStart(): void {
    this.controller.notifyLoadSessionStart();
  }

  notifyLoadSessionEnd(ok: boolean): void {
    this.controller.notifyLoadSessionEnd(ok);
  }

  notifySessionInfoUpdate(title: string | undefined | null): void {
    this.controller.notifySessionInfoUpdate(title);
  }

  showInfoMessage(message: string): void {
    this.controller.showInfoMessage(message);
  }

  clearChat(): void {
    this.controller.clearChat();
  }

  get hasChatContent(): boolean {
    return this.controller.hasChatContent;
  }

  setEditorContextLinked(linked: boolean): void {
    this.controller.setEditorContextLinked(linked);
  }

  get isEditorContextLinked(): boolean {
    return this.controller.isEditorContextLinked;
  }

  async sendPromptFromExtension(text: string): Promise<void> {
    await this.controller.sendPromptFromExtension(text);
  }

  dispose(): void {
    this.attachDisposable?.dispose();
    this.attachDisposable = undefined;
    this.view = undefined;
  }
}
