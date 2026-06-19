import * as vscode from 'vscode';

import { ChatWebviewController } from './ChatWebviewController';
import { ChatWebviewStateStore } from './ChatWebviewStateStore';
import { normalizeSharedState } from './ChatWebviewSharedState';

/**
 * Creates and restores the ACP chat editor tab (`WebviewPanel`).
 */
export class ChatEditorPanelManager implements vscode.WebviewPanelSerializer, vscode.Disposable {
  public static readonly viewType = 'acp-chat-editor';

  private panel?: vscode.WebviewPanel;
  private attachDisposable?: vscode.Disposable;
  private readonly endpointId: string;

  constructor(
    private readonly controller: ChatWebviewController,
    private readonly stateStore: ChatWebviewStateStore,
  ) {
    this.endpointId = controller.createEndpointId('editorPanel');
  }

  async open(): Promise<void> {
    if (this.panel) {
      this.panel.reveal(vscode.ViewColumn.Active);
      return;
    }

    this.panel = vscode.window.createWebviewPanel(
      ChatEditorPanelManager.viewType,
      'ACP Chat',
      vscode.ViewColumn.Active,
      {
        ...this.controller.getWebviewOptions(),
        retainContextWhenHidden: true,
      },
    );

    this.attachDisposable = this.controller.attachWebview({
      id: this.endpointId,
      kind: 'editorPanel',
      webview: this.panel.webview,
      onDispose: () => {
        this.panel = undefined;
        this.attachDisposable = undefined;
      },
    });

    this.panel.onDidDispose(() => {
      this.attachDisposable?.dispose();
      this.attachDisposable = undefined;
      this.panel = undefined;
    });

    this.panel.webview.html = await this.controller.getHtmlContent(this.panel.webview);
  }

  async deserializeWebviewPanel(panel: vscode.WebviewPanel, state: unknown): Promise<void> {
    if (state) {
      this.stateStore.hydrateFromSerializer(state);
    }

    this.panel = panel;
    panel.webview.options = this.controller.getWebviewOptions();

    this.attachDisposable?.dispose();
    this.attachDisposable = this.controller.attachWebview({
      id: this.endpointId,
      kind: 'editorPanel',
      webview: panel.webview,
      onDispose: () => {
        this.panel = undefined;
        this.attachDisposable = undefined;
      },
    });

    panel.onDidDispose(() => {
      this.attachDisposable?.dispose();
      this.attachDisposable = undefined;
      this.panel = undefined;
    });

    panel.webview.html = await this.controller.getHtmlContent(panel.webview);
  }

  getSerializerState(): unknown {
    return normalizeSharedState(this.stateStore.getSnapshot());
  }

  dispose(): void {
    this.attachDisposable?.dispose();
    this.attachDisposable = undefined;
    this.panel?.dispose();
    this.panel = undefined;
  }
}
