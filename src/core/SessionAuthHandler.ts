import * as vscode from 'vscode';
import { RequestError } from '@agentclientprotocol/sdk';
import { log, logError } from '../utils/Logger';
import type { ConnectionInfo } from './ConnectionManager';
import type { AgentManager } from './AgentManager';

/**
 * Handles interactive authentication for ACP agents.
 * Isolated to separate auth concerns from session management.
 */
export class SessionAuthHandler {
  constructor(
    private readonly agentManager: AgentManager,
  ) {}

  /**
   * Check if an error indicates authentication is required.
   */
  isAuthRequiredError(e: any): boolean {
    return (e instanceof RequestError && e.code === -32000)
      || (e?.code === -32000)
      || (typeof e?.message === 'string' && /auth.?required/i.test(e.message));
  }

  /**
   * Run interactive authentication flow.
   * Throws on cancellation or failure; caller must clean up agent process.
   */
  async runAuthFlow(
    agentName: string,
    agentId: string,
    connInfo: ConnectionInfo,
  ): Promise<void> {
    const authMethods = connInfo.initResponse.authMethods;
    if (!authMethods || authMethods.length === 0) {
      this.agentManager.killAgent(agentId);
      throw new Error(
        `Agent "${agentName}" requires authentication but did not advertise any auth methods.`,
      );
    }

    log(`Agent requires authentication. Methods: ${authMethods.map(m => m.name).join(', ')}`);

    let selectedMethod = authMethods[0];

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
        this.agentManager.killAgent(agentId);
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
        this.agentManager.killAgent(agentId);
        throw new Error('Authentication cancelled by user.');
      }
    }

    try {
      log(`Authenticating with method: ${selectedMethod.name} (${selectedMethod.id})`);
      await connInfo.connection.authenticate({ methodId: selectedMethod.id });
      log('Authentication successful');
    } catch (authErr: any) {
      logError('Authentication failed', authErr);
      this.agentManager.killAgent(agentId);
      throw new Error(`Authentication failed: ${authErr.message}`);
    }
  }
}
