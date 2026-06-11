import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';

import express from 'express';
import type { AddressInfo } from 'node:net';
import type {
  AgentCard,
  Message,
  MessageSendParams,
  Part,
  Task,
} from '@a2a-js/sdk';
import { ClientFactory, type Client } from '@a2a-js/sdk/client';
import {
  type AgentExecutor,
  DefaultRequestHandler,
  type ExecutionEventBus,
  InMemoryTaskStore,
  RequestContext,
} from '@a2a-js/sdk/server';
import {
  UserBuilder,
  agentCardHandler,
  jsonRpcHandler,
} from '@a2a-js/sdk/server/express';
import type { SessionNotification } from '@agentclientprotocol/sdk';

import { getAgentConfigs } from '../config/AgentConfig';
import { getPipelineConfig, PipelineConfig } from '../config/PipelineConfig';
import { log } from '../utils/Logger';
import { AcpAgentRunner } from './AcpAgentRunner';
import { assertSingleProposedPlan, extractSingleProposedPlan } from './ProposedPlan';

export type PipelineStatus =
  | 'planning'
  | 'awaiting_approval'
  | 'implementing'
  | 'completed'
  | 'rejected'
  | 'error'
  | 'cancelled';

export interface PipelineStatusEvent {
  sessionId: string;
  status: PipelineStatus;
  message: string;
}

export interface PipelinePlanReadyEvent {
  sessionId: string;
  plan: string;
}

export interface PipelineSessionUpdateEvent {
  sessionId: string;
  update: SessionNotification;
}

type PipelineExecutorKind = 'planner' | 'implementer';

interface PipelineRunState {
  originalPrompt: string;
  plan?: string;
  cancelled: boolean;
}

type RunnerCallback = (promptText: string, requestContext: RequestContext) => Promise<string>;
type AcpRunCallback = (
  kind: PipelineExecutorKind,
  promptText: string,
  onSessionUpdate?: (update: SessionNotification) => void,
) => Promise<string>;

export interface PipelineServiceDependencies {
  getPipelineConfig?: () => PipelineConfig;
  getAgentConfigs?: () => Record<string, unknown>;
  runAcpAgent?: AcpRunCallback;
}

class AcpBackedA2AExecutor implements AgentExecutor {
  constructor(
    private readonly runAgent: RunnerCallback,
  ) {}

  async execute(requestContext: RequestContext, eventBus: ExecutionEventBus): Promise<void> {
    const promptText = getMessageText(requestContext.userMessage);
    const result = await this.runAgent(promptText, requestContext);
    eventBus.publish(createAgentMessage(result, requestContext));
    eventBus.finished();
  }

  async cancelTask(_taskId: string, eventBus: ExecutionEventBus): Promise<void> {
    eventBus.finished();
  }
}

class LocalA2AAgentServer {
  private server: Server | null = null;
  private agentCard: AgentCard | null = null;

  constructor(
    private readonly kind: PipelineExecutorKind,
    private readonly executor: AgentExecutor,
  ) {}

  async start(): Promise<AgentCard> {
    if (this.agentCard) {
      return this.agentCard;
    }

    const app = express();
    app.use(express.json({ limit: '2mb' }));

    await new Promise<void>((resolve, reject) => {
      const server = app.listen(0, '127.0.0.1', () => {
        this.server = server;
        resolve();
      });
      server.once('error', reject);
    });

    const address = this.server?.address() as AddressInfo | null;
    if (!address) {
      throw new Error(`Failed to start ${this.kind} A2A server.`);
    }

    const baseUrl = `http://127.0.0.1:${address.port}`;
    const jsonRpcUrl = `${baseUrl}/a2a/jsonrpc`;
    this.agentCard = createAgentCard(this.kind, jsonRpcUrl);
    const requestHandler = new DefaultRequestHandler(
      this.agentCard,
      new InMemoryTaskStore(),
      this.executor,
    );

    app.use('/.well-known/agent-card.json', agentCardHandler({ agentCardProvider: requestHandler }));
    app.use('/a2a/jsonrpc', jsonRpcHandler({
      requestHandler,
      userBuilder: UserBuilder.noAuthentication,
    }));

    log(`Pipeline ${this.kind} A2A server listening on ${baseUrl}`);
    return this.agentCard;
  }

  get baseUrl(): string {
    if (!this.agentCard) {
      throw new Error(`${this.kind} A2A server is not started.`);
    }
    return this.agentCard.url.replace(/\/a2a\/jsonrpc$/, '');
  }

  async dispose(): Promise<void> {
    const server = this.server;
    this.server = null;
    this.agentCard = null;
    if (!server) {
      return;
    }

    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  }
}

export class PipelineService extends EventEmitter {
  private plannerServer: LocalA2AAgentServer | null = null;
  private implementerServer: LocalA2AAgentServer | null = null;
  private readonly runs: Map<string, PipelineRunState> = new Map();

  constructor(
    private readonly workspaceCwd: () => string,
    private readonly dependencies: PipelineServiceDependencies = {},
  ) {
    super();
  }

  async createPlan(sessionId: string, userPrompt: string): Promise<string> {
    const config = this.readPipelineConfig();
    this.assertConfiguredAgents(config);

    // Récupérer ou créer le state (NE PAS écraser)
    let state = this.runs.get(sessionId);
    const isFirstPrompt = !state;

    if (!state) {
      state = { originalPrompt: userPrompt, cancelled: false };
      this.runs.set(sessionId, state);
    }
    // Si state existe déjà, on garde originalPrompt et plan précédent

    this.emitStatus(sessionId, 'planning', `Planning with ${config.plannerAgentName}...`);

    try {
      const planner = await this.getClient('planner');
      // Inclure le plan précédent si il existe
      const prompt = state.plan
        ? buildPlannerPrompt(userPrompt, state.plan, state.originalPrompt)
        : buildPlannerPrompt(userPrompt);

      const responseText = await this.sendA2AMessage(planner, prompt, sessionId);
      this.throwIfCancelled(state);
      const plan = extractSingleProposedPlan(responseText);
      state.plan = plan;  // Mettre à jour avec le nouveau plan
      this.emit('plan-ready', { sessionId, plan } satisfies PipelinePlanReadyEvent);
      this.emitStatus(sessionId, 'awaiting_approval', 'Plan ready for review.');
      return plan;
    } catch (e: any) {
      this.emitStatus(sessionId, 'error', e.message || 'Pipeline planning failed.');
      this.runs.delete(sessionId);
      throw e;
    }
  }

  async approvePlan(sessionId: string, approvedPlan: string): Promise<string> {
    const config = this.readPipelineConfig();
    this.assertConfiguredAgents(config);
    const state = this.runs.get(sessionId);
    if (!state) {
      throw new Error('No pending pipeline plan for this session.');
    }
    assertSingleProposedPlan(approvedPlan.trim());
    state.plan = approvedPlan.trim();

    this.emitStatus(sessionId, 'implementing', `Implementing with ${config.implementerAgentName}...`);

    try {
      const implementer = await this.getClient('implementer');
      const responseText = await this.sendA2AMessage(
        implementer,
        buildImplementerPrompt(state.originalPrompt, state.plan),
        sessionId,
      );
      this.throwIfCancelled(state);
      this.emitStatus(sessionId, 'completed', 'Pipeline implementation completed.');
      this.runs.delete(sessionId);
      return responseText;
    } catch (e: any) {
      this.emitStatus(sessionId, 'error', e.message || 'Pipeline implementation failed.');
      this.runs.delete(sessionId);
      throw e;
    }
  }

  rejectPlan(sessionId: string): void {
    const state = this.runs.get(sessionId);
    if (state) {
      state.cancelled = true;
    }
    this.runs.delete(sessionId);
    this.emitStatus(sessionId, 'rejected', 'Pipeline plan rejected.');
  }

  cancel(sessionId: string): void {
    const state = this.runs.get(sessionId);
    if (state) {
      state.cancelled = true;
    }
    this.runs.delete(sessionId);
    this.emitStatus(sessionId, 'cancelled', 'Pipeline cancelled.');
  }

  async dispose(): Promise<void> {
    for (const [sessionId, state] of this.runs) {
      state.cancelled = true;
      this.emitStatus(sessionId, 'cancelled', 'Pipeline cancelled.');
    }
    this.runs.clear();
    await Promise.all([
      this.plannerServer?.dispose(),
      this.implementerServer?.dispose(),
    ]);
    this.plannerServer = null;
    this.implementerServer = null;
    this.removeAllListeners();
  }

  private async getClient(kind: PipelineExecutorKind) {
    const server = await this.getServer(kind);
    const factory = new ClientFactory();
    return factory.createFromUrl(server.baseUrl);
  }

  private async getServer(kind: PipelineExecutorKind): Promise<LocalA2AAgentServer> {
    if (kind === 'planner') {
      if (!this.plannerServer) {
        this.plannerServer = new LocalA2AAgentServer(kind, new AcpBackedA2AExecutor(
          async (promptText) => this.runConfiguredAcpAgent('planner', promptText),
        ));
      }
      await this.plannerServer.start();
      return this.plannerServer;
    }

    if (!this.implementerServer) {
      this.implementerServer = new LocalA2AAgentServer(kind, new AcpBackedA2AExecutor(
        async (promptText, requestContext) => {
          const sessionId = getPipelineSessionId(requestContext);
          return this.runConfiguredAcpAgent('implementer', promptText, (update) => {
            this.emit('session-update', { sessionId, update } satisfies PipelineSessionUpdateEvent);
          });
        },
      ));
    }
    await this.implementerServer.start();
    return this.implementerServer;
  }

  private async runConfiguredAcpAgent(
    kind: PipelineExecutorKind,
    promptText: string,
    onSessionUpdate?: (update: SessionNotification) => void,
  ): Promise<string> {
    if (this.dependencies.runAcpAgent) {
      return this.dependencies.runAcpAgent(kind, promptText, onSessionUpdate);
    }

    const config = this.readPipelineConfig();
    const agentName = kind === 'planner'
      ? config.plannerAgentName
      : config.implementerAgentName;
    const runner = new AcpAgentRunner(this.workspaceCwd);
    return runner.run(agentName, promptText, {
      onSessionUpdate: (update) => {
        if (kind === 'implementer') {
          onSessionUpdate?.(update);
        }
      },
    });
  }

  private async sendA2AMessage(client: Client, text: string, sessionId: string): Promise<string> {
    const params: MessageSendParams = {
      configuration: {
        acceptedOutputModes: ['text/plain'],
        blocking: true,
      },
      message: {
        kind: 'message',
        role: 'user',
        messageId: randomUUID(),
        metadata: {
          pipelineSessionId: sessionId,
        },
        parts: [{ kind: 'text', text }],
      },
    };
    const result = await client.sendMessage(params);
    return getA2AResultText(result);
  }

  private assertConfiguredAgents(config: PipelineConfig): void {
    const agents = this.readAgentConfigs();
    const missing = [config.plannerAgentName, config.implementerAgentName]
      .filter(agentName => !agents[agentName]);
    if (missing.length > 0) {
      throw new Error(`Missing configured ACP pipeline agent(s): ${missing.join(', ')}.`);
    }
  }

  private throwIfCancelled(state: PipelineRunState): void {
    if (state.cancelled) {
      throw new Error('Pipeline cancelled.');
    }
  }

  private emitStatus(sessionId: string, status: PipelineStatus, message: string): void {
    this.emit('status', { sessionId, status, message } satisfies PipelineStatusEvent);
  }

  private readPipelineConfig(): PipelineConfig {
    return this.dependencies.getPipelineConfig?.() ?? getPipelineConfig();
  }

  private readAgentConfigs(): Record<string, unknown> {
    return this.dependencies.getAgentConfigs?.() ?? getAgentConfigs();
  }
}

function createAgentCard(kind: PipelineExecutorKind, url: string): AgentCard {
  return {
    name: `ACP Pipeline ${kind}`,
    description: kind === 'planner'
      ? 'Produces implementation plans through a configured ACP planner agent.'
      : 'Implements approved plans through a configured ACP implementer agent.',
    version: '0.1.0',
    protocolVersion: '0.3.0',
    url,
    preferredTransport: 'JSONRPC',
    additionalInterfaces: [{ transport: 'JSONRPC', url }],
    capabilities: {
      streaming: false,
      pushNotifications: false,
      stateTransitionHistory: false,
    },
    defaultInputModes: ['text/plain'],
    defaultOutputModes: ['text/plain'],
    skills: [
      {
        id: kind,
        name: kind === 'planner' ? 'Plan' : 'Implement',
        description: kind === 'planner'
          ? 'Create a single proposed implementation plan.'
          : 'Implement a validated proposed plan.',
        tags: ['acp', 'pipeline', kind],
      },
    ],
  };
}

function createAgentMessage(text: string, requestContext: RequestContext): Message {
  return {
    kind: 'message',
    role: 'agent',
    messageId: randomUUID(),
    taskId: requestContext.taskId,
    contextId: requestContext.contextId,
    parts: [{ kind: 'text', text }],
  };
}

function getMessageText(message: Message): string {
  return getTextFromParts(message.parts);
}

function getA2AResultText(result: Message | Task): string {
  if (result.kind === 'message') {
    return getTextFromParts(result.parts);
  }
  return getTaskText(result);
}

function getPipelineSessionId(requestContext: RequestContext): string {
  const sessionId = requestContext.userMessage.metadata?.pipelineSessionId;
  if (typeof sessionId !== 'string' || !sessionId) {
    throw new Error('Missing pipeline session metadata.');
  }
  return sessionId;
}

function getTaskText(task: Task): string {
  const statusText = task.status.message ? getTextFromParts(task.status.message.parts) : '';
  const historyText = (task.history ?? [])
    .filter(message => message.role === 'agent')
    .map(message => getTextFromParts(message.parts))
    .filter(Boolean)
    .join('\n');
  const artifactText = (task.artifacts ?? [])
    .flatMap(artifact => artifact.parts ?? [])
    .map(part => getTextFromPart(part))
    .filter(Boolean)
    .join('\n');
  return [statusText, historyText, artifactText].filter(Boolean).join('\n').trim();
}

function getTextFromParts(parts: Part[]): string {
  return parts.map(part => getTextFromPart(part)).filter(Boolean).join('\n').trim();
}

function getTextFromPart(part: Part): string {
  return part.kind === 'text' ? part.text : '';
}

function buildPlannerPrompt(
  userPrompt: string,
  previousPlan?: string,
  originalPrompt?: string
): string {
  const parts = [
    'You are the planning agent in a two-agent ACP pipeline.',
    'Create an implementation plan only. Do not edit files or run commands that mutate the workspace.',
    'Your response must contain exactly one <proposed_plan> block and no other text outside it.',
    'The plan must be decision-complete enough for another coding agent to implement.',
    '',
  ];

  if (previousPlan) {
    parts.push('Previous plan:');
    parts.push(previousPlan);
    parts.push('');
    parts.push('User feedback/request:');
  } else {
    parts.push('User request:');
  }

  parts.push(userPrompt);

  if (originalPrompt && originalPrompt !== userPrompt) {
    parts.push('');
    parts.push('Original request:');
    parts.push(originalPrompt);
  }

  return parts.join('\n');
}

function buildImplementerPrompt(originalPrompt: string, approvedPlan: string): string {
  return [
    'You are the implementation agent in a two-agent ACP pipeline.',
    'Implement the approved plan in the current workspace using the available ACP capabilities.',
    'Use the existing permission policy for filesystem and terminal actions.',
    '',
    'Original user request:',
    originalPrompt,
    '',
    'Approved plan:',
    approvedPlan,
  ].join('\n');
}
