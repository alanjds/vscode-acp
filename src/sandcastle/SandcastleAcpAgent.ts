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
import * as path from 'node:path';

import type { BridgeConfig } from './BridgeConfig';
import {
  buildPromptWithHistory,
  type PromptHistoryEntry,
} from './PromptHistory';
import { enrichProviderRunError } from './ProviderRunError';
import { runGit } from './runGit';
import { applyWorktreeToHost, previewWorktreeChanges } from './WorktreePromotion';

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

/** Abstraction injectable pour créer sandboxes, providers et backends Docker du bridge ACP. */
export interface SandcastleRuntime {
  createSandbox(options: CreateSandboxOptions): Promise<Sandbox>;
  createProvider(config: BridgeConfig): AgentProvider;
  createSandboxProvider(config: BridgeConfig, cwd: string): CreateSandboxOptions['sandbox'];
}

/**
 * Agent ACP côté bridge Sandcastle.
 * Gère les sessions sandbox (worktree Git), l'exécution sérialisée des prompts,
 * le streaming vers le client ACP et les méthodes d'extension `sandcastle/*` (preview, apply, reject).
 */
export class SandcastleAcpAgent implements Agent {
  private readonly sessions = new Map<string, BridgeSession>();
  private toolCallSequence = 0;

  constructor(
    private readonly connection: AgentSideConnection,
    private readonly config: BridgeConfig,
    private readonly runtime: SandcastleRuntime,
  ) {}

  /**
   * Répond à l'initialisation ACP avec les capacités de l'agent Sandcastle.
   *
   * @param _params - Requête d'initialisation ACP (non utilisée dans ce POC).
   * @returns Version du protocole, métadonnées de l'agent et capacités supportées.
   */
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

  /**
   * Ouvre une nouvelle session ACP avec un worktree sandbox dédié sur une branche éphémère.
   *
   * @param params - Requête contenant le `cwd` du dépôt hôte.
   * @returns Identifiant de session ACP nouvellement créé.
   * @throws Si la création du sandbox échoue (la session est alors retirée de la carte).
   */
  async newSession(params: NewSessionRequest): Promise<NewSessionResponse> {
    const id = crypto.randomUUID();
    const cwd = path.resolve(params.cwd);
    const branch = `sandcastle/acp/${this.config.provider}/${id}`;
    const baseRef = await runGit(cwd, ['rev-parse', 'HEAD']);
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

  /**
   * Exécute un prompt texte dans le sandbox de la session, avec historique et streaming ACP.
   *
   * @param params - Requête contenant l'identifiant de session et les blocs de prompt.
   * @returns Raison d'arrêt (`end_turn` ou `cancelled` si abort).
   * @throws Si une autre exécution est en cours, si le prompt est invalide, ou après enrichissement d'une erreur fournisseur.
   */
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

  /**
   * Annule l'exécution en cours d'un prompt pour la session donnée.
   *
   * @param params - Notification ACP avec l'identifiant de session à annuler.
   * @returns Promise résolue après signal d'abort au contrôleur actif, si présent.
   */
  async cancel(params: CancelNotification): Promise<void> {
    this.sessions.get(params.sessionId)?.activeRun?.abort(new Error('ACP prompt cancelled.'));
  }

  /**
   * Ferme une session ACP et libère le sandbox associé (reset worktree, fermeture conteneur).
   *
   * @param params - Requête avec l'identifiant de session à fermer.
   * @returns Objet vide conforme au protocole ACP.
   */
  async closeSession(params: CloseSessionRequest): Promise<Record<string, never>> {
    const session = this.sessions.get(params.sessionId);
    if (session) {
      await this.discardSessionSandbox(session);
      this.sessions.delete(session.id);
    }
    return {};
  }

  /**
   * Dispatche les méthodes d'extension Sandcastle (`status`, `preview`, `apply`, `reject`).
   *
   * @param method - Nom de la méthode d'extension (préfixe `sandcastle/`).
   * @param params - Paramètres incluant `sessionId` pour cibler la session.
   * @returns Payload spécifique à la méthode (statut, preview, résultat apply/reject).
   * @throws Si la session est introuvable ou si la méthode n'est pas supportée.
   */
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
      case 'sandcastle/preview': {
        const sandbox = await this.ensureSandbox(session);
        return {
          ...(await previewWorktreeChanges(
            sandbox.worktreePath,
            session.baseRef,
            session.branch,
          )),
        };
      }
      case 'sandcastle/apply': {
        const sandbox = await this.ensureSandbox(session);
        const preview = await previewWorktreeChanges(
          sandbox.worktreePath,
          session.baseRef,
          session.branch,
        );
        if (!preview.diff.trim()) {
          await this.discardSessionSandbox(session);
          return { success: true, filesChanged: 0, message: 'No changes to apply.' };
        }
        const result = await applyWorktreeToHost(session.cwd, preview);
        if (result.success) {
          await this.discardSessionSandbox(session);
        }
        return result;
      }
      case 'sandcastle/reject':
        await this.discardSessionSandbox(session);
        return { success: true, message: 'Sandcastle changes rejected.' };
      default:
        throw new Error(`Unsupported Sandcastle extension method: ${method}`);
    }
  }

  /**
   * Libère toutes les sessions ouvertes lors de l'arrêt du bridge.
   *
   * @returns Promise résolue après tentative de fermeture de chaque sandbox.
   */
  async dispose(): Promise<void> {
    await Promise.allSettled([...this.sessions.values()].map(session => this.discardSessionSandbox(session)));
    this.sessions.clear();
  }

  /**
   * Crée ou réutilise le sandbox Git worktree pour la session, en réinitialisant la base si nécessaire.
   *
   * @param session - Session bridge dont le sandbox peut être absent ou obsolète.
   * @returns Instance `Sandbox` prête pour `run`.
   */
  private async ensureSandbox(session: BridgeSession): Promise<Sandbox> {
    if (session.sandbox) {
      return session.sandbox;
    }

    session.baseRef = (await runGit(session.cwd, ['rev-parse', 'HEAD'])).trim();
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

  /**
   * Concatène les blocs texte du prompt ACP en une seule chaîne non vide.
   *
   * @param params - Requête de prompt ACP.
   * @returns Texte du prompt utilisateur.
   * @throws Si un bloc non texte est reçu ou si le résultat est vide.
   */
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

  /**
   * Enfile le traitement d'un événement stream agent pour préserver l'ordre des notifications ACP.
   *
   * @param session - Session dont la chaîne `notifications` sérialise les envois.
   * @param event - Événement stream (texte ou appel d'outil).
   * @returns void ; les mises à jour sont envoyées de façon asynchrone sur la connexion ACP.
   */
  private enqueueStreamEvent(session: BridgeSession, event: AgentStreamEvent): void {
    session.notifications = session.notifications.then(async () => {
      if (event.type === 'text') {
        await this.sendText(session.id, event.message);
        return;
      }
      if (event.type !== 'toolCall') {
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

  /**
   * Envoie un fragment de message agent au client ACP.
   *
   * @param sessionId - Identifiant de la session ACP destinataire.
   * @param text - Contenu texte à streamer ; ignoré si vide.
   * @returns Promise résolue après `sessionUpdate` sur la connexion.
   */
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

  /**
   * Annule les runs actifs, réinitialise le worktree sandbox et ferme le conteneur.
   *
   * @param session - Session dont le sandbox et l'historique doivent être libérés.
   * @returns Promise résolue après reset Git et `sandbox.close()`.
   */
  private async discardSessionSandbox(session: BridgeSession): Promise<void> {
    session.activeRun?.abort(new Error('Sandcastle session closed.'));
    const sandbox = session.sandbox;
    session.sandbox = undefined;
    session.history = [];
    if (!sandbox) {
      return;
    }

    try {
      await runGit(sandbox.worktreePath, ['reset', '--hard']);
      await runGit(sandbox.worktreePath, ['clean', '-fd']);
    } finally {
      await sandbox.close();
    }
  }

  /**
   * Récupère une session bridge ou lève une erreur explicite.
   *
   * @param sessionId - Identifiant de session ACP.
   * @returns Session bridge correspondante.
   * @throws Si l'identifiant est absent ou inconnu.
   */
  private requireSession(sessionId: string): BridgeSession {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Sandcastle session not found: ${sessionId || '(missing)'}`);
    }
    return session;
  }

}
