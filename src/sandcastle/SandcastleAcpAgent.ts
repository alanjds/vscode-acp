import {
  PROTOCOL_VERSION,
  type Agent,
  type AgentSideConnection,
  type AuthenticateRequest,
  type CancelNotification,
  type CloseSessionRequest,
  type InitializeRequest,
  type InitializeResponse,
  type NewSessionRequest,
  type NewSessionResponse,
  type PromptRequest,
  type PromptResponse,
} from '@agentclientprotocol/sdk';
import type {
  AgentStreamEvent,
  AgentProvider,
  CreateSandboxOptions,
  Sandbox,
} from '@ai-hero/sandcastle';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import type { BridgeConfig } from './BridgeConfig';
import {
  buildPromptWithHistory,
  type PromptHistoryEntry,
} from './PromptHistory';
import { enrichProviderRunError } from './ProviderRunError';

const execFileAsync = promisify(execFile);
const GIT_MAX_BUFFER = 20 * 1024 * 1024;

interface BridgeSession {
  id: string;
  cwd: string;
  baseRef: string;
  branch: string;
  sandbox?: Sandbox;
  history: PromptHistoryEntry[];
  activeRun?: AbortController;
  notifications: Promise<void>;
}

interface PromotionPreview {
  diff: string;
  filesChanged: number;
  branch: string;
  baseRef: string;
  worktreePath: string;
}

export interface SandcastleRuntime {
  createSandbox(options: CreateSandboxOptions): Promise<Sandbox>;
  createProvider(config: BridgeConfig): AgentProvider;
  createSandboxProvider(config: BridgeConfig, cwd: string): CreateSandboxOptions['sandbox'];
}

export class SandcastleAcpAgent implements Agent {
  private readonly sessions = new Map<string, BridgeSession>();
  private toolCallSequence = 0;

  constructor(
    private readonly connection: AgentSideConnection,
    private readonly config: BridgeConfig,
    private readonly runtime: SandcastleRuntime,
  ) {}

  async initialize(_params: InitializeRequest): Promise<InitializeResponse> {
    return {
      protocolVersion: PROTOCOL_VERSION,
      agentInfo: {
        name: `Sandcastle ${this.config.provider}`,
        version: '0.1.0-poc',
      },
      agentCapabilities: {
        loadSession: false,
        promptCapabilities: {
          image: false,
          audio: false,
          embeddedContext: false,
        },
        sessionCapabilities: {
          close: {},
        },
      },
    };
  }

  async authenticate(_params: AuthenticateRequest): Promise<Record<string, never>> {
    return {};
  }

  async newSession(params: NewSessionRequest): Promise<NewSessionResponse> {
    const id = crypto.randomUUID();
    const cwd = path.resolve(params.cwd);
    const branch = `sandcastle/acp/${this.config.provider}/${id}`;
    const baseRef = await this.git(cwd, ['rev-parse', 'HEAD']);
    const session: BridgeSession = {
      id,
      cwd,
      baseRef: baseRef.trim(),
      branch,
      history: [],
      notifications: Promise.resolve(),
    };
    this.sessions.set(id, session);

    try {
      await this.ensureSandbox(session);
    } catch (error) {
      this.sessions.delete(id);
      throw error;
    }
    return { sessionId: id };
  }

  async prompt(params: PromptRequest): Promise<PromptResponse> {
    const session = this.requireSession(params.sessionId);
    if (session.activeRun) {
      throw new Error(`Session ${session.id} already has a prompt in progress.`);
    }

    const promptText = this.extractTextPrompt(params);
    const controller = new AbortController();
    session.activeRun = controller;
    let streamedText = false;

    try {
      const sandbox = await this.ensureSandbox(session);
      const result = await sandbox.run({
        agent: this.runtime.createProvider(this.config),
        prompt: buildPromptWithHistory(session.history, promptText),
        maxIterations: 1,
        signal: controller.signal,
        idleTimeoutSeconds: 600,
        name: `${this.config.provider}-${session.id.slice(0, 8)}`,
        logging: {
          type: 'file',
          path: path.join('.sandcastle', 'logs', `acp-${session.id}.log`),
          onAgentStreamEvent: event => {
            if (event.type === 'text' && event.message) {
              streamedText = true;
            }
            this.enqueueStreamEvent(session, event);
          },
        },
      });

      await session.notifications;
      if (!streamedText && result.stdout.trim()) {
        await this.sendText(session.id, result.stdout.trim());
      }
      session.history.push(
        { role: 'user', text: promptText },
        { role: 'assistant', text: result.stdout.trim() },
      );
      return { stopReason: 'end_turn' };
    } catch (error) {
      if (controller.signal.aborted) {
        return { stopReason: 'cancelled' };
      }
      throw enrichProviderRunError(error, {
        provider: this.config.provider,
        cwd: session.cwd,
      });
    } finally {
      if (session.activeRun === controller) {
        session.activeRun = undefined;
      }
    }
  }

  async cancel(params: CancelNotification): Promise<void> {
    this.sessions.get(params.sessionId)?.activeRun?.abort(new Error('ACP prompt cancelled.'));
  }

  async closeSession(params: CloseSessionRequest): Promise<Record<string, never>> {
    const session = this.sessions.get(params.sessionId);
    if (session) {
      await this.discardSessionSandbox(session);
      this.sessions.delete(session.id);
    }
    return {};
  }

  async extMethod(method: string, params: Record<string, unknown>): Promise<Record<string, unknown>> {
    const sessionId = typeof params.sessionId === 'string' ? params.sessionId : '';
    const session = this.requireSession(sessionId);

    switch (method) {
      case 'sandcastle/status':
        return {
          sessionId: session.id,
          provider: this.config.provider,
          model: this.config.model,
          branch: session.branch,
          baseRef: session.baseRef,
          active: Boolean(session.sandbox),
          running: Boolean(session.activeRun),
          worktreePath: session.sandbox?.worktreePath,
        };
      case 'sandcastle/preview':
        return { ...(await this.collectPreview(session)) };
      case 'sandcastle/apply':
        return this.apply(session);
      case 'sandcastle/reject':
        await this.discardSessionSandbox(session);
        return { success: true, message: 'Sandcastle changes rejected.' };
      default:
        throw new Error(`Unsupported Sandcastle extension method: ${method}`);
    }
  }

  async dispose(): Promise<void> {
    await Promise.allSettled([...this.sessions.values()].map(session => this.discardSessionSandbox(session)));
    this.sessions.clear();
  }

  private async ensureSandbox(session: BridgeSession): Promise<Sandbox> {
    if (session.sandbox) {
      return session.sandbox;
    }

    session.baseRef = (await this.git(session.cwd, ['rev-parse', 'HEAD'])).trim();
    session.branch = `sandcastle/acp/${this.config.provider}/${crypto.randomUUID()}`;
    session.history = [];
    session.sandbox = await this.runtime.createSandbox({
      cwd: session.cwd,
      branch: session.branch,
      baseBranch: session.baseRef,
      sandbox: this.runtime.createSandboxProvider(this.config, session.cwd),
    });
    return session.sandbox;
  }

  private extractTextPrompt(params: PromptRequest): string {
    const textParts: string[] = [];
    for (const block of params.prompt) {
      if (block.type !== 'text') {
        throw new Error(`Sandcastle POC only supports text prompts; received ${block.type}.`);
      }
      textParts.push(block.text);
    }
    const prompt = textParts.join('\n').trim();
    if (!prompt) {
      throw new Error('Sandcastle POC requires a non-empty text prompt.');
    }
    return prompt;
  }

  private enqueueStreamEvent(session: BridgeSession, event: AgentStreamEvent): void {
    session.notifications = session.notifications.then(async () => {
      if (event.type === 'text') {
        await this.sendText(session.id, event.message);
        return;
      }
      const toolCallId = `sandcastle-tool-${++this.toolCallSequence}`;
      await this.connection.sessionUpdate({
        sessionId: session.id,
        update: {
          sessionUpdate: 'tool_call',
          toolCallId,
          title: event.name,
          kind: 'other',
          status: 'completed',
          rawInput: event.formattedArgs,
        },
      });
    });
  }

  private async sendText(sessionId: string, text: string): Promise<void> {
    if (!text) {
      return;
    }
    await this.connection.sessionUpdate({
      sessionId,
      update: {
        sessionUpdate: 'agent_message_chunk',
        content: { type: 'text', text },
      },
    });
  }

  private async collectPreview(session: BridgeSession): Promise<PromotionPreview> {
    const sandbox = await this.ensureSandbox(session);
    await this.git(sandbox.worktreePath, ['add', '--intent-to-add', '--', '.']);
    const diff = await this.git(sandbox.worktreePath, ['diff', '--binary', session.baseRef]);
    const names = await this.git(sandbox.worktreePath, ['diff', '--name-only', session.baseRef]);
    return {
      diff,
      filesChanged: names.split('\n').map(value => value.trim()).filter(Boolean).length,
      branch: session.branch,
      baseRef: session.baseRef,
      worktreePath: sandbox.worktreePath,
    };
  }

  private async apply(session: BridgeSession): Promise<Record<string, unknown>> {
    const preview = await this.collectPreview(session);
    if (!preview.diff.trim()) {
      await this.discardSessionSandbox(session);
      return { success: true, filesChanged: 0, message: 'No changes to apply.' };
    }

    const patchPath = path.join(os.tmpdir(), `acp-sandcastle-${session.id}.patch`);
    fs.writeFileSync(patchPath, preview.diff, 'utf8');
    try {
      await this.git(session.cwd, ['apply', '--check', patchPath]);
      await this.git(session.cwd, ['apply', patchPath]);
      await this.discardSessionSandbox(session);
      return {
        success: true,
        filesChanged: preview.filesChanged,
        message: `Applied Sandcastle changes (${preview.filesChanged} file(s)).`,
      };
    } catch (error) {
      return {
        success: false,
        filesChanged: preview.filesChanged,
        message: error instanceof Error ? error.message : String(error),
      };
    } finally {
      try {
        fs.unlinkSync(patchPath);
      } catch {
        // Ignore temporary patch cleanup failures.
      }
    }
  }

  private async discardSessionSandbox(session: BridgeSession): Promise<void> {
    session.activeRun?.abort(new Error('Sandcastle session closed.'));
    const sandbox = session.sandbox;
    session.sandbox = undefined;
    session.history = [];
    if (!sandbox) {
      return;
    }

    try {
      await this.git(sandbox.worktreePath, ['reset', '--hard']);
      await this.git(sandbox.worktreePath, ['clean', '-fd']);
    } finally {
      await sandbox.close();
    }
  }

  private requireSession(sessionId: string): BridgeSession {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Sandcastle session not found: ${sessionId || '(missing)'}`);
    }
    return session;
  }

  private async git(cwd: string, args: string[]): Promise<string> {
    const result = await execFileAsync('git', args, {
      cwd,
      encoding: 'utf8',
      maxBuffer: GIT_MAX_BUFFER,
    });
    return result.stdout.toString();
  }
}
