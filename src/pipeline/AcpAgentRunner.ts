import * as vscode from 'vscode';
import type { AuthMethod, SessionNotification } from '@agentclientprotocol/sdk';
import { RequestError } from '@agentclientprotocol/sdk';

import { AgentManager } from '../core/AgentManager';
import { ConnectionInfo, ConnectionManager } from '../core/ConnectionManager';
import { SessionUpdateHandler } from '../handlers/SessionUpdateHandler';
import { getAgentConfig } from '../config/AgentConfig';
import { log, logError } from '../utils/Logger';

export interface AcpAgentRunOptions {
  onSessionUpdate?: (update: SessionNotification) => void;
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
      log(`Pipeline ACP runner: starting "${agentName}"`);
      const agentInstance = agentManager.spawnAgent(agentName, config, cwd);
      const connInfo = await connectionManager.connect(
        agentInstance.id,
        agentInstance.process,
        cwd,
      );

      const sessionResponse = await this.createSessionWithAuth(agentName, agentInstance.id, connInfo, cwd, agentManager);
      sessionId = sessionResponse.sessionId;

      await connInfo.connection.prompt({
        sessionId,
        prompt: [{ type: 'text', text: promptText }],
      });

      return collectedText.trim();
    } finally {
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
  ): Promise<{ sessionId: string }> {
    try {
      return await connInfo.connection.newSession({ cwd, mcpServers: [] });
    } catch (e: any) {
      if (!this.isAuthRequiredError(e)) {
        throw e;
      }
      await this.runAuthFlow(agentName, agentId, connInfo, agentManager);
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
  ): Promise<void> {
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

    try {
      await connInfo.connection.authenticate({ methodId: selectedMethod.id });
    } catch (authErr: any) {
      logError('Pipeline authentication failed', authErr);
      agentManager.killAgent(agentId);
      throw new Error(`Authentication failed: ${authErr.message}`);
    }
  }
}

