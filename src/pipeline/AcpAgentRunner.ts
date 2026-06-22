import * as vscode from 'vscode';
import type { AuthMethod, SessionNotification } from '@agentclientprotocol/sdk';
import { RequestError } from '@agentclientprotocol/sdk';

import { AgentManager } from '../core/AgentManager';
import { ConnectionInfo, ConnectionManager } from '../core/ConnectionManager';
import { SessionUpdateHandler } from '../handlers/SessionUpdateHandler';
import { getAgentConfig, isSandcastleAgentConfig } from '../config/AgentConfig';
import { SandcastlePromotionUi } from '../sandcastle/SandcastlePromotionUi';
import { log, logError } from '../utils/Logger';
import { RunAbortedError } from './RunAbortedError';

export interface AcpAgentRunOptions {
  onSessionUpdate?: (update: SessionNotification) => void;
  signal?: AbortSignal;
  sideEffects?: 'none' | 'workspace';
}

export class AcpAgentRunner {
  constructor(
    private readonly workspaceCwd: () => string,
  ) {}

  async run(agentName: string, promptText: string, options: AcpAgentRunOptions = {}): Promise<string> {
    const config = getAgentConfig(agentName);
    if (!config) {
      throw new Error(`Pipeline agent "${agentName}" is not configured in acp.agents.`);
    }

    const sessionUpdateHandler = new SessionUpdateHandler();
    const agentManager = new AgentManager();
    const connectionManager = new ConnectionManager(sessionUpdateHandler);
    const cwd = this.workspaceCwd();
    let sessionId: string | null = null;
    let collectedText = '';
    let connInfo: ConnectionInfo | null = null;
    let agentId: string | null = null;

    const throwIfAborted = (): void => {
      if (options.signal?.aborted) {
        throw new RunAbortedError();
      }
    };

    const onAbort = (): void => {
      void (async () => {
        if (sessionId && connInfo) {
          try {
            await connInfo.connection.cancel({ sessionId });
          } catch (e) {
            logError('Pipeline ACP runner: cancel failed', e);
          }
        }
        if (agentId) {
          agentManager.killAgent(agentId);
        } else {
          agentManager.killAll();
        }
      })();
    };

    options.signal?.addEventListener('abort', onAbort, { once: true });

    const listener = (update: SessionNotification) => {
      if (sessionId && update.sessionId !== sessionId) {
        return;
      }

      const updateData = update.update as any;
      if (updateData?.sessionUpdate === 'agent_message_chunk') {
        const content = updateData.content;
        if (content?.type === 'text' && typeof content.text === 'string') {
          collectedText += content.text;
        }
      }

      options.onSessionUpdate?.(update);
    };

    sessionUpdateHandler.addListener(listener);

    try {
      throwIfAborted();
      log(`Pipeline ACP runner: starting "${agentName}"`);
      const agentInstance = agentManager.spawnAgent(agentName, config, cwd);
      agentId = agentInstance.id;
      throwIfAborted();

      connInfo = await connectionManager.connect(
        agentInstance.id,
        agentInstance.process,
        cwd,
        { autoApproveAll: isSandcastleAgentConfig(config) },
      );
      throwIfAborted();

      const sessionResponse = await this.createSessionWithAuth(
        agentName,
        agentInstance.id,
        connInfo,
        cwd,
        agentManager,
        options.signal,
      );
      sessionId = sessionResponse.sessionId;
      throwIfAborted();

      await connInfo.connection.prompt({
        sessionId,
        prompt: [{ type: 'text', text: promptText }],
      });

      if (options.signal?.aborted) {
        throw new RunAbortedError();
      }

      if (isSandcastleAgentConfig(config)) {
        const promotionUi = new SandcastlePromotionUi();
        if (options.sideEffects === 'workspace') {
          await promotionUi.promote(connInfo.connection, sessionId);
        } else {
          await promotionUi.discard(connInfo.connection, sessionId);
        }
      }

      return collectedText.trim();
    } finally {
      options.signal?.removeEventListener('abort', onAbort);
      sessionUpdateHandler.removeListener(listener);
      agentManager.killAll();
      connectionManager.dispose();
      sessionUpdateHandler.dispose();
    }
  }

  private async createSessionWithAuth(
    agentName: string,
    agentId: string,
    connInfo: ConnectionInfo,
    cwd: string,
    agentManager: AgentManager,
    signal?: AbortSignal,
  ): Promise<{ sessionId: string }> {
    if (signal?.aborted) {
      throw new RunAbortedError();
    }

    try {
      return await connInfo.connection.newSession({ cwd, mcpServers: [] });
    } catch (e: any) {
      if (!this.isAuthRequiredError(e)) {
        throw e;
      }
      await this.runAuthFlow(agentName, agentId, connInfo, agentManager, signal);
      if (signal?.aborted) {
        throw new RunAbortedError();
      }
      return connInfo.connection.newSession({ cwd, mcpServers: [] });
    }
  }

  private isAuthRequiredError(e: any): boolean {
    return (e instanceof RequestError && e.code === -32000)
      || (e?.code === -32000)
      || (typeof e?.message === 'string' && /auth.?required/i.test(e.message));
  }

  private async runAuthFlow(
    agentName: string,
    agentId: string,
    connInfo: ConnectionInfo,
    agentManager: AgentManager,
    signal?: AbortSignal,
  ): Promise<void> {
    if (signal?.aborted) {
      agentManager.killAgent(agentId);
      throw new RunAbortedError();
    }

    const authMethods = connInfo.initResponse.authMethods;
    if (!authMethods || authMethods.length === 0) {
      agentManager.killAgent(agentId);
      throw new Error(
        `Agent "${agentName}" requires authentication but did not advertise any auth methods.`,
      );
    }

    let selectedMethod: AuthMethod = authMethods[0];
    if (authMethods.length > 1) {
      const picked = await vscode.window.showQuickPick(
        authMethods.map(m => ({
          label: m.name,
          description: m.description || '',
          detail: `ID: ${m.id}`,
          method: m,
        })),
        {
          placeHolder: 'Select an authentication method',
          title: `${agentName} requires authentication`,
        },
      );
      if (!picked) {
        agentManager.killAgent(agentId);
        throw new Error('Authentication cancelled by user.');
      }
      selectedMethod = picked.method;
    } else {
      const confirm = await vscode.window.showInformationMessage(
        `${agentName} requires authentication via "${selectedMethod.name}".`,
        { modal: true, detail: selectedMethod.description || undefined },
        'Authenticate',
      );
      if (confirm !== 'Authenticate') {
        agentManager.killAgent(agentId);
        throw new Error('Authentication cancelled by user.');
      }
    }

    if (signal?.aborted) {
      agentManager.killAgent(agentId);
      throw new RunAbortedError();
    }

    try {
      await connInfo.connection.authenticate({ methodId: selectedMethod.id });
    } catch (authErr: any) {
      logError('Pipeline authentication failed', authErr);
      agentManager.killAgent(agentId);
      throw new Error(`Authentication failed: ${authErr.message}`);
    }
  }
}
