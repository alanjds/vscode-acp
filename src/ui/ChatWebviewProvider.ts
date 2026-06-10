import * as vscode from 'vscode';
import { marked } from 'marked';
import type { SessionNotification } from '@agentclientprotocol/sdk';

import { SessionManager } from '../core/SessionManager';
import { SessionUpdateHandler, SessionUpdateListener } from '../handlers/SessionUpdateHandler';
import { log, logError } from '../utils/Logger';
import { sendEvent } from '../utils/TelemetryManager';
import { buildPromptWithEditorContext, type EditorContext } from './EditorContext';
import { getReactShellHtmlContent } from './WebviewHtml';

type GetEditorContext = () => EditorContext | null;

type WebviewMessage = {
  type: string;
  [key: string]: unknown;
};

type FileSelection = {
  startLine?: number;
  startCharacter?: number;
  endLine?: number;
  endCharacter?: number;
  text?: string;
  cursorLine?: number;
  cursorCharacter?: number;
} | null;

/**
 * WebviewViewProvider for the ACP chat sidebar.
 * The extension host owns ACP/session behavior; the React webview owns rendering.
 */
export class ChatWebviewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'acp-chat';

  private view?: vscode.WebviewView;
  private readonly updateListener: SessionUpdateListener;
  private _hasChatContent = false;
  private editorContextLinked = false;
  private isViewReady = false;
  private pendingMessages: WebviewMessage[] = [];

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly sessionManager: SessionManager,
    private readonly sessionUpdateHandler: SessionUpdateHandler,
    private readonly getEditorContext: GetEditorContext = () => null,
  ) {
    marked.setOptions({
      breaks: true,
      gfm: true,
    });

    this.updateListener = (update: SessionNotification) => {
      this.handleSessionUpdate(update);
    };
    this.sessionUpdateHandler.addListener(this.updateListener);
    log('ChatWebviewProvider: session update listener registered');
  }

  private renderMarkdown(text: string): string {
    try {
      return marked.parse(text) as string;
    } catch {
      return this.escapeHtml(text);
    }
  }

  private escapeHtml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  async resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ): Promise<void> {
    this.view = webviewView;
    this.isViewReady = false;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'resources', 'webview')],
    };

    webviewView.webview.onDidReceiveMessage(async (message: WebviewMessage) => {
      switch (message.type) {
        case 'sendPrompt':
          this._hasChatContent = true;
          await this.handleSendPrompt(String(message.text ?? ''));
          break;
        case 'cancelTurn':
          await this.handleCancelTurn();
          break;
        case 'setMode':
          await this.handleSetMode(String(message.modeId ?? ''));
          break;
        case 'setModel':
          await this.handleSetModel(String(message.modelId ?? ''));
          break;
        case 'setConfigOption':
          await this.handleSetConfigOption(String(message.configId ?? ''), String(message.value ?? ''));
          break;
        case 'executeCommand':
          if (typeof message.command === 'string' && message.command) {
            await vscode.commands.executeCommand(message.command);
          }
          break;
        case 'ready':
          this.isViewReady = true;
          this.sendCurrentState();
          this.flushPendingMessages();
          break;
        case 'renderMarkdown': {
          const items = Array.isArray(message.items)
            ? message.items as Array<{ index: number; text: string }>
            : [];
          const rendered = items.map((item) => ({
            index: item.index,
            html: this.renderMarkdown(item.text),
          }));
          this.postMessage({ type: 'markdownRendered', items: rendered });
          break;
        }
      }
    });

    webviewView.onDidDispose(() => {
      this.view = undefined;
      this.isViewReady = false;
      this.pendingMessages = [];
    });

    webviewView.webview.html = await this.getHtmlContent(webviewView.webview);
  }

  /**
   * Forward session update to webview.
   */
  private handleSessionUpdate(update: SessionNotification): void {
    const updateData = update.update as any;

    // Persist session state before the active-session check. During session
    // creation, agents can dispatch notifications before connectToAgent has
    // finished setting activeSessionId.
    if (updateData?.sessionUpdate === 'available_commands_update') {
      this.sessionManager.applyAvailableCommands(
        update.sessionId,
        updateData.availableCommands || [],
      );
    }
    if (updateData?.sessionUpdate === 'config_option_update') {
      this.sessionManager.applyConfigOptions(
        update.sessionId,
        updateData.configOptions || [],
      );
    }
    if (updateData?.sessionUpdate === 'session_info_update') {
      this.sessionManager.applySessionInfoUpdate(update.sessionId, {
        title: updateData.title,
        updatedAt: updateData.updatedAt,
      });
    }

    const activeId = this.sessionManager.getActiveSessionId();
    if (update.sessionId !== activeId) {
      return;
    }

    this.postMessage({
      type: 'sessionUpdate',
      update: update.update,
      sessionId: update.sessionId,
    });
  }

  /**
   * Handle a prompt sent from the webview.
   */
  private async handleSendPrompt(text: string): Promise<void> {
    const activeId = this.sessionManager.getActiveSessionId();
    if (!activeId) {
      this.postMessage({
        type: 'error',
        message: 'No active session. Create a session first.',
      });
      return;
    }

    const editorContext = this.editorContextLinked ? this.getEditorContext() : null;
    const agentText = this.editorContextLinked && editorContext
      ? buildPromptWithEditorContext(text, editorContext)
      : text;

    if (this.editorContextLinked && !editorContext) {
      this.postMessage({
        type: 'info',
        message: 'No editor context available - sending prompt without context.',
      });
    }

    sendEvent('chat/messageSent', {
      agentName: this.sessionManager.getActiveAgentName() ?? '',
    }, {
      messageLength: agentText.length,
    });

    // Keep history labels based on the raw user text, not enriched context.
    this.sessionManager.recordFirstPrompt(activeId, text);
    this.postMessage({ type: 'promptStart' });

    try {
      const response = await this.sessionManager.sendPrompt(activeId, agentText);
      this.postMessage({
        type: 'promptEnd',
        stopReason: response.stopReason,
        usage: (response as any).usage,
      });
      this.sessionManager.touchHistory(activeId);
    } catch (e: any) {
      logError('Prompt failed', e);
      this.postMessage({
        type: 'error',
        message: e.message || 'Prompt failed',
      });
      this.postMessage({ type: 'promptEnd', stopReason: 'error' });
    }
  }

  /**
   * Handle cancel request from webview.
   */
  private async handleCancelTurn(): Promise<void> {
    const activeId = this.sessionManager.getActiveSessionId();
    if (!activeId) {
      return;
    }

    try {
      await this.sessionManager.cancelTurn(activeId);
    } catch (e) {
      logError('Cancel failed', e);
    }
  }

  /**
   * Handle mode change from webview picker.
   */
  private async handleSetMode(modeId: string): Promise<void> {
    const activeId = this.sessionManager.getActiveSessionId();
    if (!activeId || !modeId) {
      return;
    }

    try {
      await this.sessionManager.setMode(activeId, modeId);
    } catch (e: any) {
      logError('Failed to set mode', e);
      this.postMessage({ type: 'error', message: `Failed to set mode: ${e.message}` });
    }
  }

  /**
   * Handle model change from webview picker.
   */
  private async handleSetModel(modelId: string): Promise<void> {
    const activeId = this.sessionManager.getActiveSessionId();
    if (!activeId || !modelId) {
      return;
    }

    try {
      await this.sessionManager.setModel(activeId, modelId);
    } catch (e: any) {
      logError('Failed to set model', e);
      this.postMessage({ type: 'error', message: `Failed to set model: ${e.message}` });
    }
  }

  /**
   * Handle generic config-option changes from the React picker.
   */
  private async handleSetConfigOption(configId: string, value: string): Promise<void> {
    const activeId = this.sessionManager.getActiveSessionId();
    if (!activeId || !configId) {
      return;
    }

    try {
      const options = await this.sessionManager.setConfigOption(activeId, configId, value);
      this.postMessage({ type: 'configOptionsUpdate', configOptions: options });
    } catch (e: any) {
      logError('Failed to set config option', e);
      this.postMessage({ type: 'error', message: `Failed to set ${configId}: ${e.message}` });
      const session = this.sessionManager.getSession(activeId);
      this.postMessage({
        type: 'configOptionsUpdate',
        configOptions: session?.configOptions ?? null,
      });
    }
  }

  /**
   * Send current session state to the webview on load.
   */
  private sendCurrentState(): void {
    if (!this.view || !this.isViewReady) {
      return;
    }

    const activeId = this.sessionManager.getActiveSessionId();
    const session = activeId ? this.sessionManager.getSession(activeId) : null;
    this.view.webview.postMessage({
      type: 'state',
      activeSessionId: activeId,
      session: session ? {
        sessionId: session.sessionId,
        agentName: session.agentDisplayName,
        title: session.title,
        cwd: session.cwd,
        modes: session.modes,
        models: session.models,
        configOptions: session.configOptions,
        availableCommands: session.availableCommands,
      } : null,
    });
  }

  /**
   * Post a message to the webview, queueing until React reports readiness.
   */
  private postMessage(message: WebviewMessage): void {
    if (!this.view) {
      return;
    }

    if (!this.isViewReady) {
      this.pendingMessages.push(message);
      return;
    }

    this.view.webview.postMessage(message);
  }

  private flushPendingMessages(): void {
    if (!this.view || !this.isViewReady || this.pendingMessages.length === 0) {
      return;
    }

    const messages = this.pendingMessages;
    this.pendingMessages = [];
    for (const message of messages) {
      this.view.webview.postMessage(message);
    }
  }

  /**
   * Notify webview of a new active session.
   */
  notifyActiveSessionChanged(): void {
    this.sendCurrentState();
  }

  /**
   * Notify webview of mode state changes.
   */
  notifyModesUpdate(modes: any): void {
    this.postMessage({ type: 'modesUpdate', modes });
  }

  /**
   * Notify webview of model state changes.
   */
  notifyModelsUpdate(models: any): void {
    this.postMessage({ type: 'modelsUpdate', models });
  }

  /**
   * Notify webview of session config-option state changes.
   */
  notifyConfigOptionsUpdate(configOptions: any): void {
    this.postMessage({ type: 'configOptionsUpdate', configOptions });
  }

  /**
   * Notify webview that a `session/load` replay is starting.
   */
  notifyLoadSessionStart(): void {
    this.postMessage({ type: 'loadSessionStart' });
  }

  /**
   * Notify webview that the active replay finished.
   */
  notifyLoadSessionEnd(ok: boolean): void {
    this.postMessage({ type: 'loadSessionEnd', ok });
  }

  /**
   * Notify webview that session title / metadata changed.
   */
  notifySessionInfoUpdate(title: string | undefined | null): void {
    this.postMessage({ type: 'sessionInfoUpdate', title: title ?? null });
  }

  /**
   * Clear the chat history and reset to welcome state.
   */
  clearChat(): void {
    this._hasChatContent = false;
    this.postMessage({ type: 'clearChat' });
  }

  get hasChatContent(): boolean {
    return this._hasChatContent;
  }

  setEditorContextLinked(linked: boolean): void {
    this.editorContextLinked = linked;
  }

  get isEditorContextLinked(): boolean {
    return this.editorContextLinked;
  }

  async sendPromptFromExtension(text: string): Promise<void> {
    if (!text.trim()) {
      return;
    }

    if (!this.sessionManager.getActiveSessionId()) {
      await this.handleSendPrompt(text);
      return;
    }

    this._hasChatContent = true;
    this.postMessage({ type: 'externalUserMessage', text });
    await this.handleSendPrompt(text);
  }

  /**
   * Attach a file URI to the next prompt.
   */
  attachFile(uri: vscode.Uri, selection?: FileSelection): void {
    const payload: WebviewMessage = {
      type: 'file-attached',
      path: uri.fsPath,
      name: uri.fsPath.split(/[\\/]/).pop() || uri.fsPath,
    };

    if (selection) {
      payload.selection = selection;
    }

    this.postMessage(payload);
    this.view?.show?.(true);
  }

  dispose(): void {
    this.sessionUpdateHandler.removeListener(this.updateListener);
  }

  private async getHtmlContent(webview: vscode.Webview): Promise<string> {
    return getReactShellHtmlContent(this.extensionUri, webview, 'chat');
  }
}
