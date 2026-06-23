import * as vscode from 'vscode';

export type ChatWebviewEndpointKind = 'view' | 'editorPanel';

export type WebviewMessage = {
  type: string;
  [key: string]: unknown;
};

export interface AttachWebviewOptions {
  id: string;
  kind: ChatWebviewEndpointKind;
  webview: vscode.Webview;
  onDispose?: () => void;
}

interface ChatWebviewEndpoint {
  id: string;
  kind: ChatWebviewEndpointKind;
  webview: vscode.Webview;
  ready: boolean;
  pendingMessages: WebviewMessage[];
  disposables: vscode.Disposable[];
}

export type WebviewMessageHandler = (endpointId: string, message: WebviewMessage) => void | Promise<void>;

/**
 * Manages multi-webview endpoint lifecycle and message delivery.
 */
export class ChatWebviewTransport implements vscode.Disposable {
  private readonly endpoints = new Map<string, ChatWebviewEndpoint>();
  private nextEndpointId = 0;

  constructor(private readonly onMessage: WebviewMessageHandler) {}

  attachWebview(options: AttachWebviewOptions): vscode.Disposable {
    const endpoint: ChatWebviewEndpoint = {
      id: options.id,
      kind: options.kind,
      webview: options.webview,
      ready: false,
      pendingMessages: [],
      disposables: [],
    };

    endpoint.disposables.push(
      options.webview.onDidReceiveMessage(async (message: WebviewMessage) => {
        await this.onMessage(endpoint.id, message);
      }),
    );

    if (options.onDispose) {
      endpoint.disposables.push({ dispose: options.onDispose });
    }

    this.endpoints.set(endpoint.id, endpoint);
    return {
      dispose: () => {
        this.detachWebview(endpoint.id);
      },
    };
  }

  detachWebview(endpointId: string): void {
    const endpoint = this.endpoints.get(endpointId);
    if (!endpoint) {
      return;
    }

    for (const disposable of endpoint.disposables) {
      disposable.dispose();
    }
    this.endpoints.delete(endpointId);
  }

  createEndpointId(kind: ChatWebviewEndpointKind): string {
    this.nextEndpointId += 1;
    return `${kind}-${this.nextEndpointId}`;
  }

  markEndpointReady(endpointId: string): void {
    const endpoint = this.endpoints.get(endpointId);
    if (!endpoint) {
      return;
    }
    endpoint.ready = true;
  }

  flushPendingMessages(endpointId: string): void {
    const endpoint = this.endpoints.get(endpointId);
    if (!endpoint || !endpoint.ready || endpoint.pendingMessages.length === 0) {
      return;
    }

    const messages = endpoint.pendingMessages;
    endpoint.pendingMessages = [];
    for (const message of messages) {
      void endpoint.webview.postMessage(message);
    }
  }

  isEndpointReady(endpointId: string): boolean {
    return this.endpoints.get(endpointId)?.ready ?? false;
  }

  postMessage(
    message: WebviewMessage,
    endpointId?: string,
    exceptEndpointId?: string,
  ): void {
    if (endpointId) {
      this.postMessageToEndpoint(endpointId, message);
      return;
    }

    for (const [id] of this.endpoints) {
      if (id === exceptEndpointId) {
        continue;
      }
      this.postMessageToEndpoint(id, message);
    }
  }

  private postMessageToEndpoint(endpointId: string, message: WebviewMessage): void {
    const endpoint = this.endpoints.get(endpointId);
    if (!endpoint) {
      return;
    }

    if (!endpoint.ready) {
      endpoint.pendingMessages.push(message);
      return;
    }

    void endpoint.webview.postMessage(message);
  }

  dispose(): void {
    for (const endpointId of [...this.endpoints.keys()]) {
      this.detachWebview(endpointId);
    }
  }
}
