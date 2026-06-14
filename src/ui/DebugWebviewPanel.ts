import * as vscode from 'vscode';

import { DebugTraceStore, DebugTraceSnapshot } from '../core/DebugTraceStore';
import { SessionManager, SessionInfo } from '../core/SessionManager';
import { logError } from '../utils/Logger';
import { getReactShellHtmlContent } from './WebviewHtml';

type DebugPanelMessage = {
  type: string;
  [key: string]: unknown;
};

export interface DebugSnapshot {
  version: 1;
  generatedAt: string;
  extension: {
    version: string;
  };
  activeSession: SessionDebugSnapshot | null;
  trace: DebugTraceSnapshot;
  chatState: unknown;
}

type SessionDebugSnapshot = Omit<SessionInfo, 'initResponse'> & {
  initResponse: unknown;
  contextFamily: unknown;
};

export class DebugWebviewPanel {
  private panel?: vscode.WebviewPanel;
  private lastChatState: unknown = null;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly sessionManager: SessionManager,
    private readonly debugTraceStore: DebugTraceStore,
    private readonly extensionVersion: string,
  ) {}

  async open(chatState?: unknown): Promise<void> {
    if (chatState !== undefined) {
      this.lastChatState = chatState;
    }

    if (this.panel) {
      this.panel.reveal(vscode.ViewColumn.One);
      this.postSnapshot();
      return;
    }

    this.panel = vscode.window.createWebviewPanel(
      'acpDebugSnapshot',
      'ACP Debug',
      vscode.ViewColumn.One,
      {
        enableScripts: true,
        localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'resources', 'webview')],
        retainContextWhenHidden: true,
      },
    );

    this.panel.webview.onDidReceiveMessage(async (message: DebugPanelMessage) => {
      switch (message.type) {
        case 'ready':
        case 'refreshDebugSnapshot':
          this.postSnapshot();
          break;
        case 'copyDebugSnapshot':
          await this.copySnapshot();
          break;
        case 'exportDebugSnapshot':
          await this.exportSnapshot();
          break;
      }
    });

    this.panel.onDidDispose(() => {
      this.panel = undefined;
    });

    this.panel.webview.html = await getReactShellHtmlContent(this.extensionUri, this.panel.webview, 'debug');
  }

  private postSnapshot(): void {
    if (!this.panel) {
      return;
    }
    const snapshot = this.buildSnapshot();
    this.panel.webview.postMessage({
      type: 'debugSnapshot',
      snapshot,
    });
  }

  private buildSnapshot(): DebugSnapshot {
    const session = this.sessionManager.getActiveSession();
    return {
      version: 1,
      generatedAt: new Date().toISOString(),
      extension: {
        version: this.extensionVersion,
      },
      activeSession: session ? this.toSessionDebugSnapshot(session) : null,
      trace: this.debugTraceStore.snapshot(),
      chatState: this.lastChatState,
    };
  }

  private toSessionDebugSnapshot(session: SessionInfo): SessionDebugSnapshot {
    return {
      ...session,
      initResponse: session.initResponse,
      contextFamily: this.sessionManager.getSessionContextFamily(session.sessionId),
    };
  }

  private getSnapshotJson(): string {
    const snapshot = this.buildSnapshot();
    return JSON.stringify(snapshot, null, 2);
  }

  private async copySnapshot(): Promise<void> {
    try {
      await vscode.env.clipboard.writeText(this.getSnapshotJson());
      vscode.window.setStatusBarMessage('ACP debug snapshot copied.', 2500);
    } catch (e) {
      logError('Failed to copy debug snapshot', e);
      vscode.window.showErrorMessage('Failed to copy ACP debug snapshot.');
    }
  }

  private async exportSnapshot(): Promise<void> {
    try {
      const document = await vscode.workspace.openTextDocument({
        language: 'json',
        content: this.getSnapshotJson(),
      });
      await vscode.window.showTextDocument(document, { preview: false });
    } catch (e) {
      logError('Failed to export debug snapshot', e);
      vscode.window.showErrorMessage('Failed to export ACP debug snapshot.');
    }
  }

  dispose(): void {
    this.panel?.dispose();
    this.panel = undefined;
  }
}
