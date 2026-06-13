import * as vscode from 'vscode';
import * as path from 'path';
import { marked } from 'marked';
import type { SessionNotification } from '@agentclientprotocol/sdk';

import { SessionManager } from '../core/SessionManager';
import { DebugTraceStore } from '../core/DebugTraceStore';
import { SessionUpdateHandler, SessionUpdateListener } from '../handlers/SessionUpdateHandler';
import { ALLOWED_WEBVIEW_COMMANDS } from '../security/SecurityPolicy';
import { log, logError } from '../utils/Logger';
import { sendEvent } from '../utils/TelemetryManager';
import { buildPromptWithEditorContext, type EditorContext } from './EditorContext';
import { getReactShellHtmlContent } from './WebviewHtml';
import {
  PipelinePlanReadyEvent,
  PipelineService,
  PipelineSessionUpdateEvent,
  PipelineStatusEvent,
} from '../pipeline/PipelineService';

type GetEditorContext = () => EditorContext | null;
type OpenDebugSnapshot = (chatState: unknown) => void | Promise<void>;

type WebviewMessage = {
  type: string;
  [key: string]: unknown;
};

const FILE_SEARCH_LIMIT = 30;

function getTextUpdateContent(updateData: any): string | null {
  const content = updateData?.content;
  return content?.type === 'text' && typeof content.text === 'string'
    ? content.text
    : null;
}

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
  private readonly pipelineService: PipelineService | null;
  private readonly getEditorContext: GetEditorContext;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly sessionManager: SessionManager,
    private readonly sessionUpdateHandler: SessionUpdateHandler,
    pipelineServiceOrGetEditorContext: PipelineService | GetEditorContext | null = null,
    getEditorContext: GetEditorContext = () => null,
    private readonly debugTraceStore?: DebugTraceStore,
    private readonly openDebugSnapshot?: OpenDebugSnapshot,
  ) {
    if (typeof pipelineServiceOrGetEditorContext === 'function') {
      this.pipelineService = null;
      this.getEditorContext = pipelineServiceOrGetEditorContext;
    } else {
      this.pipelineService = pipelineServiceOrGetEditorContext;
      this.getEditorContext = getEditorContext;
    }

    marked.setOptions({
      breaks: true,
      gfm: true,
    });

    this.updateListener = (update: SessionNotification) => {
      this.handleSessionUpdate(update);
    };
    this.sessionUpdateHandler.addListener(this.updateListener);
    this.pipelineService?.on('status', this.handlePipelineStatus);
    this.pipelineService?.on('plan-ready', this.handlePipelinePlanReady);
    this.pipelineService?.on('session-update', this.handlePipelineSessionUpdate);
    log('ChatWebviewProvider: session update listener registered');
  }

  private readonly handlePipelineStatus = (event: PipelineStatusEvent) => {
    if (event.sessionId !== this.sessionManager.getActiveSessionId()) {
      return;
    }
    this.postMessage({
      type: 'pipelineStatus',
      status: event.status,
      message: event.message,
    });
  };

  private readonly handlePipelinePlanReady = (event: PipelinePlanReadyEvent) => {
    if (event.sessionId !== this.sessionManager.getActiveSessionId()) {
      return;
    }
    this.postMessage({
      type: 'pipelinePlanReady',
      plan: event.plan,
    });
  };

  private readonly handlePipelineSessionUpdate = (event: PipelineSessionUpdateEvent) => {
    if (event.sessionId !== this.sessionManager.getActiveSessionId()) {
      return;
    }
    this.postMessage({
      type: 'sessionUpdate',
      update: event.update.update,
      sessionId: event.sessionId,
    });
  };

  private renderMarkdown(text: string): string {
    try {
      const html = marked.parse(text) as string;
      return this.sanitizeHtml(html);
    } catch {
      return this.escapeHtml(text);
    }
  }

  private sanitizeHtml(html: string): string {
    return html
      // Remove script tags and content
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
      // Remove iframe tags
      .replace(/<iframe\b[^>]*>/gi, '')
      // Remove on* attributes (event handlers)
      .replace(/\s+on\w+\s*=\s*["'][^"']*["']/gi, '')
      // Remove javascript: URLs
      .replace(/href\s*=\s*["']javascript:[^"']*["']/gi, '')
      // Remove any remaining dangerous content
      .replace(/<[^>]+\s+style\s*=\s*["'][^"']*expression\([^"']*["']/gi, '');
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
        case 'approvePipelinePlan':
          await this.handleApprovePipelinePlan(String(message.plan ?? ''));
          break;
        case 'rejectPipelinePlan':
          await this.handleRejectPipelinePlan();
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
        case 'searchFiles':
          await this.handleSearchFiles(String(message.query ?? ''), Number(message.requestId ?? 0));
          break;
        case 'openFile':
          await this.handleOpenFile(String(message.path ?? ''));
          break;
        case 'openDebugSnapshot':
          await this.openDebugSnapshot?.(message.chatState ?? null);
          break;
        case 'executeCommand':
          if (typeof message.command === 'string' && message.command && ALLOWED_WEBVIEW_COMMANDS.has(message.command)) {
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
    if (updateData?.sessionUpdate === 'agent_message_chunk') {
      const text = getTextUpdateContent(updateData);
      if (text) {
        this.sessionManager.recordAssistantMessageChunk(update.sessionId, text);
      }
    }
    if (updateData?.sessionUpdate === 'user_message_chunk' && this.sessionManager.isLoading(update.sessionId)) {
      const text = getTextUpdateContent(updateData);
      if (text) {
        this.sessionManager.recordUserMessageChunk(update.sessionId, text);
      }
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
    const promptStartedAt = Date.now();

    this.debugTraceStore?.record({
      category: 'prompt',
      sessionId: activeId,
      method: 'sendPrompt',
      status: 'started',
      payload: {
        rawText: text,
        agentText,
        editorContextLinked: this.editorContextLinked,
        editorContext,
        agentName: this.sessionManager.getActiveAgentName(),
      },
    });

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
    this.sessionManager.recordUserMessage(activeId, text);
    this.postMessage({ type: 'promptStart' });

    try {
      const response = await this.sessionManager.sendPrompt(activeId, agentText);
      this.debugTraceStore?.record({
        category: 'prompt',
        sessionId: activeId,
        method: 'sendPrompt',
        status: 'completed',
        durationMs: Date.now() - promptStartedAt,
        payload: response,
      });
      this.postMessage({
        type: 'promptEnd',
        stopReason: response.stopReason,
        usage: (response as any).usage,
      });
      this.sessionManager.touchHistory(activeId);
    } catch (e: any) {
      logError('Prompt failed', e);
      this.debugTraceStore?.record({
        category: 'prompt',
        sessionId: activeId,
        method: 'sendPrompt',
        status: 'failed',
        durationMs: Date.now() - promptStartedAt,
        payload: e,
      });
      this.postMessage({
        type: 'error',
        message: e.message || 'Prompt failed',
      });
      this.postMessage({ type: 'promptEnd', stopReason: 'error' });
    }
  }

  private async handleApprovePipelinePlan(plan: string): Promise<void> {
    const activeId = this.sessionManager.getActiveSessionId();
    if (!activeId || !this.sessionManager.isPipelineSession(activeId) || !this.pipelineService) {
      return;
    }

    this.postMessage({ type: 'promptStart' });

    try {
      await this.pipelineService.approvePlan(activeId, plan);
      this.postMessage({ type: 'promptEnd', stopReason: 'end_turn' });
      this.sessionManager.touchHistory(activeId);
    } catch (e: any) {
      logError('Pipeline implementation failed', e);
      this.postMessage({
        type: 'error',
        message: e.message || 'Pipeline implementation failed',
      });
      this.postMessage({ type: 'promptEnd', stopReason: 'error' });
    }
  }

  private async handleRejectPipelinePlan(): Promise<void> {
    const activeId = this.sessionManager.getActiveSessionId();
    if (!activeId || !this.sessionManager.isPipelineSession(activeId) || !this.pipelineService) {
      return;
    }
    this.pipelineService.rejectPlan(activeId);
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
   * Search workspace files for the `@file` mention popup.
   */
  private async handleSearchFiles(query: string, requestId: number): Promise<void> {
    const normalizedQuery = query.trim().replace(/\\/g, '/');
    const words = normalizedQuery.split('/').filter(Boolean);
    const glob = words.length > 0
      ? `**/${words.map(word => `*${this.escapeGlobSegment(word)}*`).join('/')}`
      : '**/*';

    try {
      const uris = await vscode.workspace.findFiles(
        glob,
        '**/{node_modules,.git,dist,out}/**',
        FILE_SEARCH_LIMIT,
      );
      const results = disambiguateFileSearchResults(uris.map(uri => {
        const workspaceFolder = vscode.workspace.getWorkspaceFolder(uri);
        const relativePath = workspaceFolder
          ? path.relative(workspaceFolder.uri.fsPath, uri.fsPath).replace(/\\/g, '/')
          : uri.fsPath.replace(/\\/g, '/');
        return {
          path: relativePath,
          name: uri.fsPath.split(/[\\/]/).pop() || relativePath,
        };
      }));

      this.postMessage({ type: 'fileSearchResults', requestId, results });
    } catch (e: any) {
      logError('File search failed', e);
      this.postMessage({ type: 'fileSearchResults', requestId, results: [] });
    }
  }

  private escapeGlobSegment(value: string): string {
    return value.replace(/[{}[\]*?\\]/g, match => `[${match}]`);
  }

  private async handleOpenFile(filePath: string): Promise<void> {
    if (!filePath) {
      return;
    }

    try {
      const uri = this.resolveWorkspaceFileUri(filePath);
      if (!uri) {
        return;
      }
      const document = await vscode.workspace.openTextDocument(uri);
      await vscode.window.showTextDocument(document, { preview: true });
    } catch (e) {
      logError('Failed to open file mention', e);
    }
  }

  private resolveWorkspaceFileUri(filePath: string): vscode.Uri | null {
    if (filePath.startsWith('/') || /^[A-Za-z]:[\\/]/.test(filePath)) {
      return vscode.Uri.file(filePath);
    }

    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
      return null;
    }

    return vscode.Uri.joinPath(workspaceFolder.uri, ...filePath.split('/').filter(Boolean));
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
        contextFamily: this.sessionManager.getSessionContextFamily(session.sessionId),
        pendingSharedContext: this.sessionManager.hasPendingSharedDiscussionContext(session.sessionId),
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

  showInfoMessage(message: string): void {
    this._hasChatContent = true;
    this.postMessage({ type: 'info', message });
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

  dispose(): void {
    this.sessionUpdateHandler.removeListener(this.updateListener);
    this.pipelineService?.off('status', this.handlePipelineStatus);
    this.pipelineService?.off('plan-ready', this.handlePipelinePlanReady);
    this.pipelineService?.off('session-update', this.handlePipelineSessionUpdate);
  }

  private async getHtmlContent(webview: vscode.Webview): Promise<string> {
    return getReactShellHtmlContent(this.extensionUri, webview, 'chat');
  }
}

function disambiguateFileSearchResults(
  results: Array<{ path: string; name: string }>,
): Array<{ path: string; name: string }> {
  const byName = new Map<string, Array<{ path: string; name: string }>>();
  for (const result of results) {
    const bucket = byName.get(result.name) ?? [];
    bucket.push(result);
    byName.set(result.name, bucket);
  }

  return results.map(result => {
    const duplicates = byName.get(result.name) ?? [];
    if (duplicates.length <= 1) {
      return result;
    }
    return {
      ...result,
      name: shortestUniqueSuffix(result.path, duplicates.map(candidate => candidate.path)),
    };
  });
}

function shortestUniqueSuffix(pathValue: string, allPaths: string[]): string {
  const parts = pathValue.split('/').filter(Boolean);
  for (let count = 1; count <= parts.length; count += 1) {
    const suffix = parts.slice(parts.length - count).join('/');
    const matches = allPaths.filter(candidate => {
      const candidateParts = candidate.split('/').filter(Boolean);
      return candidateParts.slice(candidateParts.length - count).join('/') === suffix;
    });
    if (matches.length === 1) {
      return suffix;
    }
  }
  return pathValue;
}
