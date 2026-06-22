import * as vscode from 'vscode';
import * as path from 'path';
import { marked } from 'marked';
import type { SessionNotification } from '@agentclientprotocol/sdk';

import { SessionManager } from '../core/SessionManager';
import { classifyAgentError, formatAgentErrorMessage } from '../core/AgentError';
import { DebugTraceStore } from '../core/DebugTraceStore';
import { SessionUpdateHandler, SessionUpdateListener } from '../handlers/SessionUpdateHandler';
import { ALLOWED_WEBVIEW_COMMANDS } from '../security/SecurityPolicy';
import { HtmlSanitizer } from './HtmlSanitizer';
import { log, logError } from '../utils/Logger';
import { sendEvent } from '../utils/TelemetryManager';
import { buildPromptWithEditorContext, type EditorContext } from './EditorContext';
import {
  createFileSearchIndex,
  searchIndexedFiles,
  type FileSearchEntry,
  type IndexedFile,
} from './FileSearchIndex';
import { getReactShellHtmlContent } from './WebviewHtml';
import { ChatWebviewStateStore } from './ChatWebviewStateStore';
import {
  ChatWebviewSharedState,
  hasChatContentFromSnapshot,
} from './ChatWebviewSharedState';

type GetEditorContext = () => EditorContext | null;
type OpenDebugSnapshot = (chatState: unknown) => void | Promise<void>;

type WebviewMessage = {
  type: string;
  [key: string]: unknown;
};

export type ChatWebviewMessageHandler = (message: WebviewMessage) => void | Promise<void>;

export type ChatWebviewEndpointKind = 'view' | 'editorPanel';

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

const FILE_SEARCH_RESULT_LIMIT = 30;
const FILE_SEARCH_INDEX_LIMIT = 5000;

/**
 * Orchestrates ACP chat behavior and broadcasts UI/session events to all attached webviews.
 */
export class ChatWebviewController implements vscode.Disposable {
  private readonly endpoints = new Map<string, ChatWebviewEndpoint>();
  private readonly updateListener: SessionUpdateListener;
  private editorContextLinked = false;
  private readonly featureMessageHandlers = new Map<string, ChatWebviewMessageHandler>();
  private fileSearchIndexPromise: Promise<{ index: ReturnType<typeof createFileSearchIndex>; files: IndexedFile[] }> | null = null;
  private readonly fileSearchDisposables: vscode.Disposable[] = [];
  private readonly promptInFlightBySession = new Set<string>();
  private nextEndpointId = 0;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly sessionManager: SessionManager,
    private readonly sessionUpdateHandler: SessionUpdateHandler,
    private readonly stateStore: ChatWebviewStateStore,
    private readonly getEditorContext: GetEditorContext = () => null,
    private readonly debugTraceStore?: DebugTraceStore,
    private readonly openDebugSnapshot?: OpenDebugSnapshot,
  ) {
    marked.setOptions({
      breaks: true,
      gfm: true,
    });

    this.fileSearchDisposables.push(
      vscode.workspace.onDidCreateFiles(() => this.invalidateFileSearchIndex()),
      vscode.workspace.onDidDeleteFiles(() => this.invalidateFileSearchIndex()),
      vscode.workspace.onDidRenameFiles(() => this.invalidateFileSearchIndex()),
      vscode.workspace.onDidChangeWorkspaceFolders(() => this.invalidateFileSearchIndex()),
    );

    this.updateListener = (update: SessionNotification) => {
      this.handleSessionUpdate(update);
    };
    this.sessionUpdateHandler.addListener(this.updateListener);

    this.stateStore.onDidChange((snapshot, sourceEndpointId) => {
      if (!sourceEndpointId) {
        return;
      }
      this.broadcastSharedState(snapshot, sourceEndpointId);
    });

    log('ChatWebviewController: session update listener registered');
  }

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
        await this.handleWebviewMessage(endpoint.id, message);
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

  async getHtmlContent(webview: vscode.Webview): Promise<string> {
    return getReactShellHtmlContent(this.extensionUri, webview, 'chat');
  }

  getWebviewOptions(): vscode.WebviewOptions {
    return {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'resources', 'webview')],
    };
  }

  private renderMarkdown(text: string): string {
    return HtmlSanitizer.renderMarkdown(text);
  }

  private async handleWebviewMessage(endpointId: string, message: WebviewMessage): Promise<void> {
    switch (message.type) {
      case 'sendPrompt':
        await this.handleSendPrompt(
          String(message.text ?? ''),
          typeof message.agentText === 'string' ? message.agentText : undefined,
        );
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
      case 'sharedStateChanged':
        if (message.state && typeof message.state === 'object') {
          this.stateStore.updateFromWebview(message.state as ChatWebviewSharedState, endpointId);
        }
        break;
      case 'ready':
        this.markEndpointReady(endpointId);
        break;
      case 'renderMarkdown': {
        const items = Array.isArray(message.items)
          ? message.items as Array<{ index: number; text: string }>
          : [];
        const rendered = items.map((item) => ({
          index: item.index,
          html: this.renderMarkdown(item.text),
        }));
        this.postMessage({ type: 'markdownRendered', items: rendered }, endpointId);
        break;
      }
      default:
        await this.featureMessageHandlers.get(message.type)?.(message);
        break;
    }
  }

  private markEndpointReady(endpointId: string): void {
    const endpoint = this.endpoints.get(endpointId);
    if (!endpoint) {
      return;
    }

    endpoint.ready = true;
    this.sendHydrateSharedState(endpointId);
    this.sendCurrentState(endpointId);
    this.flushPendingMessages(endpointId);
  }

  private handleSessionUpdate(update: SessionNotification): void {
    const updateData = update.update as any;

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
    this.sessionManager.ingestSessionUpdate(update.sessionId, update);

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

  private async handleSendPrompt(text: string, agentPromptText?: string): Promise<void> {
    const activeId = this.sessionManager.getActiveSessionId();
    if (!activeId) {
      this.postMessage({
        type: 'error',
        message: 'No active session. Create a session first.',
      });
      return;
    }

    if (this.promptInFlightBySession.has(activeId)) {
      log(`Ignoring duplicate sendPrompt for session ${activeId}`);
      return;
    }
    this.promptInFlightBySession.add(activeId);

    const baseAgentText = agentPromptText ?? text;
    const editorContext = this.editorContextLinked ? this.getEditorContext() : null;
    const agentText = this.editorContextLinked && editorContext
      ? buildPromptWithEditorContext(baseAgentText, editorContext)
      : baseAgentText;
    const promptStartedAt = Date.now();

    this.debugTraceStore?.record({
      category: 'prompt',
      sessionId: activeId,
      method: 'sendPrompt',
      status: 'started',
      payload: {
        rawText: text,
        baseAgentText,
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
      const classified = classifyAgentError(e);
      logError('Prompt failed', e);
      this.debugTraceStore?.record({
        category: 'prompt',
        sessionId: activeId,
        method: 'sendPrompt',
        status: 'failed',
        durationMs: Date.now() - promptStartedAt,
        payload: e,
      });
      const detail = formatAgentErrorMessage(e);
      const message = classified.kind === 'provider-quota' || classified.kind === 'provider-auth'
        ? `${detail}\n\n${classified.actionHint}`
        : detail;
      this.postMessage({
        type: 'error',
        message: message || 'Prompt failed',
      });
      this.postMessage({ type: 'promptEnd', stopReason: 'error' });
    } finally {
      this.promptInFlightBySession.delete(activeId);
    }
  }

  private async handleCancelTurn(): Promise<void> {
    const activeId = this.sessionManager.getActiveSessionId();
    if (!activeId) {
      return;
    }

    try {
      await this.sessionManager.cancelTurn(activeId);
      this.postMessage({ type: 'promptEnd', stopReason: 'cancelled' });
    } catch (e) {
      logError('Cancel failed', e);
      this.postMessage({ type: 'promptEnd', stopReason: 'error' });
    }
  }

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

  private async handleSearchFiles(query: string, requestId: number): Promise<void> {
    try {
      const { index, files } = await this.getFileSearchIndex();
      const results = disambiguateFileSearchResults(
        searchIndexedFiles(index, files, query.replace(/\\/g, '/'), FILE_SEARCH_RESULT_LIMIT),
      );

      this.postMessage({ type: 'fileSearchResults', requestId, results });
    } catch (e: any) {
      logError('File search failed', e);
      this.postMessage({ type: 'fileSearchResults', requestId, results: [] });
    }
  }

  private getFileSearchIndex(): Promise<{ index: ReturnType<typeof createFileSearchIndex>; files: IndexedFile[] }> {
    this.fileSearchIndexPromise ??= this.buildFileSearchIndex();
    return this.fileSearchIndexPromise;
  }

  private async buildFileSearchIndex(): Promise<{ index: ReturnType<typeof createFileSearchIndex>; files: IndexedFile[] }> {
    const uris = await vscode.workspace.findFiles(
      '**/*',
      '**/{node_modules,.git,dist,out}/**',
      FILE_SEARCH_INDEX_LIMIT,
    );

    const files = uris.map((uri, index) => {
      const workspaceFolder = vscode.workspace.getWorkspaceFolder(uri);
      const relativePath = workspaceFolder
        ? path.relative(workspaceFolder.uri.fsPath, uri.fsPath).replace(/\\/g, '/')
        : uri.fsPath.replace(/\\/g, '/');

      return {
        id: `${index}:${relativePath}`,
        path: relativePath,
        name: uri.fsPath.split(/[\\/]/).pop() || relativePath,
        content: '',
      };
    });

    return {
      index: createFileSearchIndex(files),
      files,
    };
  }

  private invalidateFileSearchIndex(): void {
    this.fileSearchIndexPromise = null;
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

  private sendHydrateSharedState(endpointId?: string): void {
    const snapshot = this.stateStore.getSnapshot();
    this.postMessage({ type: 'hydrateSharedState', state: snapshot }, endpointId);
  }

  private sendCurrentState(endpointId?: string): void {
    const activeId = this.sessionManager.getActiveSessionId();
    const session = activeId ? this.sessionManager.getSession(activeId) : null;
    this.postMessage({
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
    }, endpointId);
  }

  private broadcastSharedState(snapshot: ChatWebviewSharedState, sourceEndpointId: string): void {
    this.postMessage(
      { type: 'sharedStateUpdated', state: snapshot },
      undefined,
      sourceEndpointId,
    );
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

  registerFeatureMessageHandler(type: string, handler: ChatWebviewMessageHandler): vscode.Disposable {
    if (this.featureMessageHandlers.has(type)) {
      throw new Error(`A chat feature handler is already registered for "${type}".`);
    }
    this.featureMessageHandlers.set(type, handler);
    return new vscode.Disposable(() => {
      if (this.featureMessageHandlers.get(type) === handler) {
        this.featureMessageHandlers.delete(type);
      }
    });
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

  private flushPendingMessages(endpointId: string): void {
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

  notifyActiveSessionChanged(): void {
    this.sendCurrentState();
  }

  notifyModesUpdate(modes: any): void {
    this.postMessage({ type: 'modesUpdate', modes });
  }

  notifyModelsUpdate(models: any): void {
    this.postMessage({ type: 'modelsUpdate', models });
  }

  notifyConfigOptionsUpdate(configOptions: any): void {
    this.postMessage({ type: 'configOptionsUpdate', configOptions });
  }

  notifyLoadSessionStart(): void {
    this.postMessage({ type: 'loadSessionStart' });
  }

  notifyLoadSessionEnd(ok: boolean): void {
    this.postMessage({ type: 'loadSessionEnd', ok });
  }

  notifySessionInfoUpdate(title: string | undefined | null): void {
    this.postMessage({ type: 'sessionInfoUpdate', title: title ?? null });
  }

  showInfoMessage(message: string): void {
    this.postMessage({ type: 'info', message });
  }

  clearChat(): void {
    this.stateStore.clear();
    this.postMessage({ type: 'clearChat' });
  }

  get hasChatContent(): boolean {
    return hasChatContentFromSnapshot(this.stateStore.getSnapshot());
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

    this.postMessage({ type: 'externalUserMessage', text });
    await this.handleSendPrompt(text);
  }

  dispose(): void {
    this.sessionUpdateHandler.removeListener(this.updateListener);
    this.featureMessageHandlers.clear();
    for (const disposable of this.fileSearchDisposables) {
      disposable.dispose();
    }
    for (const endpointId of [...this.endpoints.keys()]) {
      this.detachWebview(endpointId);
    }
  }
}

function disambiguateFileSearchResults(
  results: FileSearchEntry[],
): FileSearchEntry[] {
  const byName = new Map<string, FileSearchEntry[]>();
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
