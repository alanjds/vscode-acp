import type {
  Client,
  Agent,
  RequestPermissionRequest,
  RequestPermissionResponse,
  SessionNotification,
  WriteTextFileRequest,
  WriteTextFileResponse,
  ReadTextFileRequest,
  ReadTextFileResponse,
  CreateTerminalRequest,
  CreateTerminalResponse,
  TerminalOutputRequest,
  TerminalOutputResponse,
  WaitForTerminalExitRequest,
  WaitForTerminalExitResponse,
  KillTerminalRequest,
  KillTerminalResponse,
  ReleaseTerminalRequest,
  ReleaseTerminalResponse,
} from '@agentclientprotocol/sdk';

import { FileSystemHandler } from '../handlers/FileSystemHandler';
import { TerminalHandler } from '../handlers/TerminalHandler';
import { PermissionHandler } from '../handlers/PermissionHandler';
import { SessionUpdateHandler } from '../handlers/SessionUpdateHandler';
import { DebugTraceStore } from './DebugTraceStore';
import { log } from '../utils/Logger';

/**
 * ACP Client implementation for VS Code.
 * Delegates to individual handlers for each capability.
 *
 * Passed as a factory to ClientSideConnection:
 *   new ClientSideConnection((agent) => new AcpClientImpl(...), stream)
 */
export class AcpClientImpl implements Client {
  private agent: Agent | null = null;

  constructor(
    private readonly fsHandler: FileSystemHandler,
    private readonly terminalHandler: TerminalHandler,
    private readonly permissionHandler: PermissionHandler,
    private readonly sessionUpdateHandler: SessionUpdateHandler,
    private readonly debugTraceStore?: DebugTraceStore,
    private readonly agentId?: string,
  ) {}

  setAgent(agent: Agent): void {
    this.agent = agent;
  }

  getAgent(): Agent | null {
    return this.agent;
  }

  // --- Required methods ---

  async requestPermission(
    params: RequestPermissionRequest,
  ): Promise<RequestPermissionResponse> {
    return this.traceClientCall('client/requestPermission', params, () =>
      this.permissionHandler.requestPermission(params));
  }

  async sessionUpdate(params: SessionNotification): Promise<void> {
    this.sessionUpdateHandler.handleUpdate(params);
  }

  // --- File system methods ---

  async writeTextFile(
    params: WriteTextFileRequest,
  ): Promise<WriteTextFileResponse> {
    log(`Client.writeTextFile: ${params.path}`);
    return this.traceClientCall('client/writeTextFile', params, () =>
      this.fsHandler.writeTextFile(params));
  }

  async readTextFile(
    params: ReadTextFileRequest,
  ): Promise<ReadTextFileResponse> {
    log(`Client.readTextFile: ${params.path}`);
    return this.traceClientCall('client/readTextFile', params, () =>
      this.fsHandler.readTextFile(params));
  }

  // --- Terminal methods ---

  async createTerminal(
    params: CreateTerminalRequest,
  ): Promise<CreateTerminalResponse> {
    return this.traceClientCall('client/createTerminal', params, () =>
      this.terminalHandler.createTerminal(params));
  }

  async terminalOutput(
    params: TerminalOutputRequest,
  ): Promise<TerminalOutputResponse> {
    return this.traceClientCall('client/terminalOutput', params, () =>
      this.terminalHandler.terminalOutput(params));
  }

  async waitForTerminalExit(
    params: WaitForTerminalExitRequest,
  ): Promise<WaitForTerminalExitResponse> {
    return this.traceClientCall('client/waitForTerminalExit', params, () =>
      this.terminalHandler.waitForTerminalExit(params));
  }

  async killTerminal(
    params: KillTerminalRequest,
  ): Promise<KillTerminalResponse> {
    return this.traceClientCall('client/killTerminal', params, () =>
      this.terminalHandler.killTerminal(params));
  }

  async releaseTerminal(
    params: ReleaseTerminalRequest,
  ): Promise<ReleaseTerminalResponse> {
    return this.traceClientCall('client/releaseTerminal', params, () =>
      this.terminalHandler.releaseTerminal(params));
  }

  private async traceClientCall<T>(method: string, params: unknown, call: () => Promise<T>): Promise<T> {
    const startedAt = Date.now();
    this.debugTraceStore?.record({
      category: 'client-request',
      agentId: this.agentId,
      method,
      payload: params,
    });

    try {
      const response = await call();
      this.debugTraceStore?.record({
        category: 'client-response',
        agentId: this.agentId,
        method,
        status: 'completed',
        durationMs: Date.now() - startedAt,
        payload: response,
      });
      return response;
    } catch (e) {
      this.debugTraceStore?.record({
        category: 'client-error',
        agentId: this.agentId,
        method,
        status: 'failed',
        durationMs: Date.now() - startedAt,
        payload: e,
      });
      throw e;
    }
  }
}
