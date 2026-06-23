import type { SessionNotification } from '@agentclientprotocol/sdk';

import { getAgentConfig, isSandcastleAgentConfig } from '../config/AgentConfig';
import { SessionUpdateHandler } from '../handlers/SessionUpdateHandler';
import { buildPromptWithSkills } from '../skills/SkillsPromptBuilder';
import { isSkillsEnabledAgent } from '../skills/SkillsConfig';
import { prepareCursorSkillsSymlink } from '../skills/SkillsWorkspacePrep';
import { SkillsCatalog } from '../skills/SkillsCatalog';
import { log, logError } from '../utils/Logger';
import { connectEphemeralAcpAgent, createEphemeralAcpSession } from './AgentConnectionFactory';
import { AgentManager } from './AgentManager';
import type { ConnectionInfo } from './ConnectionManager';
import { RunAbortedError } from './RunAbortedError';
import { SessionAuthHandler } from './SessionAuthHandler';

export interface EphemeralRunSandboxContext {
  connection: {
    extMethod(method: string, params: Record<string, unknown>): Promise<Record<string, unknown>>;
  };
  sessionId: string;
  /** Tear down the bridge process after Sandcastle promotion finishes. */
  dispose: () => void;
}

export interface EphemeralRunOptions {
  onSessionUpdate?: (update: SessionNotification) => void;
  signal?: AbortSignal;
}

export interface EphemeralRunResult {
  text: string;
  sandbox?: EphemeralRunSandboxContext;
}

export interface EphemeralRunInput extends EphemeralRunOptions {
  workspaceCwd: string;
  agentName: string;
  promptText: string;
}

/**
 * Short-lived ACP run for PipelineStep and InlineEdit — spawn, prompt, teardown.
 * Does not register a ConnectedAgent or SessionRecord.
 */
export async function runEphemeralRun(input: EphemeralRunInput): Promise<EphemeralRunResult> {
  const { workspaceCwd: cwd, agentName, promptText, onSessionUpdate, signal } = input;
  const config = getAgentConfig(agentName);
  if (!config) {
    throw new Error(`EphemeralRun agent "${agentName}" is not configured in acp.agents.`);
  }

  const sessionUpdateHandler = new SessionUpdateHandler();
  const authHandler = new SessionAuthHandler(new AgentManager());
  let sessionId: string | null = null;
  let collectedText = '';
  let connInfo: ConnectionInfo | null = null;
  let disposeRun = (): void => {};

  const throwIfAborted = (): void => {
    if (signal?.aborted) {
      throw new RunAbortedError();
    }
  };

  const onAbort = (): void => {
    void (async () => {
      if (sessionId && connInfo) {
        try {
          await connInfo.connection.cancel({ sessionId });
        } catch (e) {
          logError('EphemeralRun: cancel failed', e);
        }
      }
      disposeRun();
    })();
  };

  signal?.addEventListener('abort', onAbort, { once: true });

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

    onSessionUpdate?.(update);
  };

  sessionUpdateHandler.addListener(listener);

  let deferCleanup = false;

  try {
    throwIfAborted();
    log(`EphemeralRun: starting "${agentName}"`);

    const connection = await connectEphemeralAcpAgent({
      agentName,
      config,
      workspaceCwd: cwd,
      sessionUpdateHandler,
    });
    connInfo = connection.connInfo;
    disposeRun = connection.dispose;
    throwIfAborted();

    const sessionResponse = await createEphemeralAcpSession(
      agentName,
      connection.agentId,
      connInfo,
      cwd,
      authHandler,
      throwIfAborted,
    );
    sessionId = sessionResponse.sessionId;
    throwIfAborted();

    if (isSkillsEnabledAgent(agentName)) {
      if (agentName === 'Cursor CLI') {
        prepareCursorSkillsSymlink(cwd);
      }
      const skills = new SkillsCatalog(cwd).listSkills();
      log(`EphemeralRun: discovered ${skills.length} skill(s) for "${agentName}"`);
    }

    const skillsResult = buildPromptWithSkills({
      agentName,
      workspaceCwd: cwd,
      text: promptText,
      skillsBootstrapped: false,
    });

    await connInfo.connection.prompt({
      sessionId,
      prompt: [{ type: 'text', text: skillsResult.text }],
    });

    if (signal?.aborted) {
      throw new RunAbortedError();
    }

    const result: EphemeralRunResult = {
      text: collectedText.trim(),
    };

    if (isSandcastleAgentConfig(config)) {
      deferCleanup = true;
      result.sandbox = {
        connection: connInfo.connection,
        sessionId,
        dispose: disposeRun,
      };
    }

    return result;
  } finally {
    signal?.removeEventListener('abort', onAbort);
    sessionUpdateHandler.removeListener(listener);
    if (!deferCleanup) {
      disposeRun();
    }
  }
}
