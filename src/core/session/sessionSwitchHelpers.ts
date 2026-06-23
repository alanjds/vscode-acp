import type { DiscussionContextHandler, SharedDiscussionContext } from '../DiscussionContextHandler';
import type { SessionState } from '../SessionState';
import type { WorkspaceIdentity } from '../WorkspaceIdentity';
import { SkillsCatalog } from '../../skills/SkillsCatalog';
import { isSkillsEnabledAgent, isCursorCliAgent } from '../../skills/SkillsConfig';
import { prepareCursorSkillsSymlink } from '../../skills/SkillsWorkspacePrep';
import { log } from '../../utils/Logger';
import type { OpenSessionOptions } from './sessionTypes';

type PendingContextEmitter = (event: 'pending-shared-context-changed', sessionId: string) => void;

/**
 * Build shared discussion context when switching to a new agent connection.
 * Skips handoff when the target agent is already active.
 */
export function resolveSharedContextForAgentConnect(
  discussionContextHandler: DiscussionContextHandler,
  sessionState: SessionState,
  options: OpenSessionOptions,
  targetAgentName: string,
): SharedDiscussionContext | null {
  if (!options.shareCurrentContext) {
    return null;
  }
  const currentAgent = sessionState.getActiveAgentName();
  if (!currentAgent || currentAgent === targetAgentName) {
    return null;
  }
  return discussionContextHandler.buildSharedDiscussionContextForTarget(
    targetAgentName,
    sessionState.getActiveSession(),
    undefined,
  );
}

/**
 * Build shared discussion context when opening an existing session (load/resume).
 */
export function resolveSharedContextForSessionOpen(
  discussionContextHandler: DiscussionContextHandler,
  sessionState: SessionState,
  options: OpenSessionOptions,
  targetAgentName: string,
  targetSessionId: string,
): SharedDiscussionContext | null {
  if (!options.shareCurrentContext) {
    return null;
  }
  return discussionContextHandler.buildSharedDiscussionContextForTarget(
    targetAgentName,
    sessionState.getActiveSession(),
    targetSessionId,
  );
}

/** Persist pending context and link the context family after a session switch. */
export function applySharedDiscussionContextHandoff(
  discussionContextHandler: DiscussionContextHandler,
  sharedContext: SharedDiscussionContext,
  targetAgentName: string,
  sessionId: string,
  workspace: WorkspaceIdentity | string,
  emit: PendingContextEmitter,
): void {
  discussionContextHandler.setPending(sessionId, sharedContext.text);
  discussionContextHandler.linkContextFamily(
    sharedContext,
    targetAgentName,
    sessionId,
    workspace,
  );
  emit('pending-shared-context-changed', sessionId);
}

export function fingerprintAgentConfig(config: unknown): string | undefined {
  try {
    return JSON.stringify(config);
  } catch {
    return undefined;
  }
}

export function prepareSkillsForAgent(agentName: string, workspaceCwd: string): void {
  if (!isSkillsEnabledAgent(agentName)) {
    return;
  }

  if (isCursorCliAgent(agentName)) {
    prepareCursorSkillsSymlink(workspaceCwd);
  }

  const catalog = new SkillsCatalog(workspaceCwd);
  const skills = catalog.listSkills();
  log(`Skills: discovered ${skills.length} skill(s) for agent "${agentName}"`);
}
