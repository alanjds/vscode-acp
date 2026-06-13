import * as vscode from 'vscode';
import {
  type WorkspaceIdentity,
  normalizeWorkspaceKey,
  workspaceIdentityFromCwd,
} from './WorkspaceIdentity';

/**
 * Lifecycle status for locally-known sessions. The tree view hides stale
 * statuses by default, but keeping them prevents silent data loss.
 */
export type PersistedSessionStatus =
  | 'available'
  | 'missing'
  | 'agentUnavailable'
  | 'agentRemoved';

/**
 * Persistent client-side cache of past sessions per workspace + agent.
 */
export interface PersistedSessionEntry {
  /** Stable normalized workspace key. */
  workspaceKey: string;
  /** Working directory the session was created in. */
  cwd: string;
  /** Agent name (as configured by the user). */
  agentName: string;
  /** Lightweight fingerprint of the agent configuration at observation time. */
  agentFingerprint?: string;
  /** Session ID issued by the agent. */
  sessionId: string;
  /** Title supplied via `session_info_update`, if any. */
  title?: string;
  /** First user prompt of the session, used as a label fallback (truncated). */
  firstPrompt?: string;
  /** ISO timestamp when the session was first observed. */
  createdAt: string;
  /** ISO timestamp of the most recent activity (prompt end / update). */
  lastActiveAt: string;
  /** Saved discussion turns for carrying context across agents. */
  discussion?: PersistedDiscussionMessage[];
  /** Stable identifier shared by sessions derived from the same context. */
  contextFamilyId?: string;
  /** Direct source session that provided context to this session. */
  contextLinkedFrom?: PersistedContextLink;
  /** ISO timestamp when this session joined its context family. */
  contextLinkedAt?: string;
  /** Availability status of the local record. */
  status: PersistedSessionStatus;
}

export interface PersistedDiscussionMessage {
  role: 'user' | 'assistant';
  text: string;
}

export interface PersistedContextLink {
  agentName: string;
  sessionId: string;
  createdAt: string;
}

export interface ContextFamilyInfo {
  contextFamilyId: string;
  contextLinkedFrom?: PersistedContextLink;
  contextLinkedAt?: string;
}

interface PersistedSessionEntryV1 {
  agentName: string;
  cwd: string;
  sessionId: string;
  title?: string;
  firstPrompt?: string;
  createdAt: string;
  lastActiveAt: string;
}

interface PersistedShapeV1 {
  version: 1;
  entries: PersistedSessionEntryV1[];
}

interface PersistedShapeV2 {
  version: 2;
  entries: PersistedSessionEntry[];
}

const STATE_KEY_V1 = 'acp.sessionHistory.v1';
const STATE_KEY_V2 = 'acp.sessionHistory.v2';
const MAX_PROMPT_LEN = 120;
const DEFAULT_CAP_PER_AGENT_WORKSPACE = 50;
const DEFAULT_VISIBLE_STATUSES = new Set<PersistedSessionStatus>(['available']);
const MAX_DISCUSSION_MESSAGES = 40;
const MAX_DISCUSSION_MESSAGE_LEN = 8_000;
const DEFAULT_CONTEXT_MAX_CHARS = 12_000;

export interface SessionHistoryListOptions {
  includeStatuses?: readonly PersistedSessionStatus[];
}

type WorkspaceFilter = string | WorkspaceIdentity | undefined;

/**
 * Wraps `workspaceState` storage of {@link PersistedSessionEntry}. Entries are
 * scoped by a normalized workspace key so multi-root/default-directory flows
 * use the same identity everywhere.
 */
export class SessionHistoryStore {
  private entries: PersistedSessionEntry[] = [];
  private readonly _onDidChange = new vscode.EventEmitter<void>();
  /** Fires whenever the cache mutates. Tree view subscribes for refresh. */
  readonly onDidChange = this._onDidChange.event;

  constructor(
    private readonly workspaceState: vscode.Memento,
    private readonly capPerAgentWorkspace: number = DEFAULT_CAP_PER_AGENT_WORKSPACE,
  ) {
    const rawV2 = this.workspaceState.get<PersistedShapeV2>(STATE_KEY_V2);
    if (rawV2 && rawV2.version === 2 && Array.isArray(rawV2.entries)) {
      this.entries = rawV2.entries.map(normalizeV2Entry).filter(isPersistedEntry);
      return;
    }

    const rawV1 = this.workspaceState.get<PersistedShapeV1>(STATE_KEY_V1);
    if (rawV1 && rawV1.version === 1 && Array.isArray(rawV1.entries)) {
      this.entries = rawV1.entries.map(migrateV1Entry);
      this.persist(false);
    }
  }

  /**
   * Get entries for a given agent + optional workspace, sorted by
   * `lastActiveAt` descending. By default only available sessions are shown.
   */
  list(
    agentName: string,
    workspace?: WorkspaceFilter,
    options: SessionHistoryListOptions = {},
  ): PersistedSessionEntry[] {
    const workspaceKey = workspaceKeyFromFilter(workspace);
    const statuses = new Set(options.includeStatuses ?? DEFAULT_VISIBLE_STATUSES);
    return this.entries
      .filter(e => e.agentName === agentName)
      .filter(e => !workspaceKey || e.workspaceKey === workspaceKey || normalizeWorkspaceKey(e.cwd) === workspaceKey)
      .filter(e => statuses.has(e.status))
      .sort((a, b) => (b.lastActiveAt || '').localeCompare(a.lastActiveAt || ''));
  }

  /** Look up a specific entry by agent + session id, optionally scoped to a workspace. */
  get(
    agentName: string,
    sessionId: string,
    workspace?: WorkspaceFilter,
  ): PersistedSessionEntry | undefined {
    const workspaceKey = workspaceKeyFromFilter(workspace);
    return this.entries.find(e =>
      e.agentName === agentName
      && e.sessionId === sessionId
      && (!workspaceKey || e.workspaceKey === workspaceKey || normalizeWorkspaceKey(e.cwd) === workspaceKey),
    );
  }

  /** Return persisted context-family metadata for a session, if present. */
  getContextFamily(agentName: string, sessionId: string, workspace?: WorkspaceFilter): ContextFamilyInfo | null {
    const entry = this.get(agentName, sessionId, workspace);
    if (!entry?.contextFamilyId) {
      return null;
    }
    return {
      contextFamilyId: entry.contextFamilyId,
      contextLinkedFrom: entry.contextLinkedFrom,
      contextLinkedAt: entry.contextLinkedAt,
    };
  }

  /** Return true when an agent has at least one cached session in the family. */
  agentHasContextFamily(agentName: string, contextFamilyId: string, workspace?: WorkspaceFilter): boolean {
    const workspaceKey = workspaceKeyFromFilter(workspace);
    return this.entries.some(e =>
      e.agentName === agentName
      && e.contextFamilyId === contextFamilyId
      && (!workspaceKey || e.workspaceKey === workspaceKey || normalizeWorkspaceKey(e.cwd) === workspaceKey),
    );
  }

  /**
   * Insert a new session entry or refresh an existing one. Called when the
   * client successfully creates a session via `session/new`.
   */
  upsertNew(
    agentName: string,
    workspace: string | WorkspaceIdentity,
    sessionId: string,
    agentFingerprint?: string,
  ): void {
    const identity = identityFromWorkspace(workspace);
    const existing = this.get(agentName, sessionId, identity);
    if (existing) {
      existing.workspaceKey = identity.key;
      existing.cwd = identity.cwd;
      existing.agentFingerprint = agentFingerprint ?? existing.agentFingerprint;
      existing.status = 'available';
      existing.lastActiveAt = new Date().toISOString();
      this.persist();
      return;
    }

    const now = new Date().toISOString();
    this.entries.push({
      workspaceKey: identity.key,
      cwd: identity.cwd,
      agentName,
      agentFingerprint,
      sessionId,
      createdAt: now,
      lastActiveAt: now,
      status: 'available',
    });
    this.enforceCap(agentName, identity.key);
    this.persist();
  }

  /** Update title from a `session_info_update` notification. */
  setTitle(agentName: string, sessionId: string, title: string | null | undefined): void {
    const entry = this.get(agentName, sessionId);
    if (!entry) { return; }
    if (title === null) {
      delete entry.title;
    } else if (typeof title === 'string') {
      entry.title = title;
    }
    this.persist();
  }

  /** Record the first user prompt of a session for label fallback. */
  setFirstPromptIfMissing(agentName: string, sessionId: string, prompt: string): void {
    const entry = this.get(agentName, sessionId);
    if (!entry || entry.firstPrompt) { return; }
    entry.firstPrompt = prompt.slice(0, MAX_PROMPT_LEN);
    this.persist();
  }

  /** Append a full user message to the saved discussion transcript. */
  appendUserMessage(agentName: string, sessionId: string, text: string): void {
    this.appendDiscussionMessage(agentName, sessionId, 'user', text, false);
  }

  /** Append a streamed user-message chunk, merging it into the previous user message. */
  appendUserMessageChunk(agentName: string, sessionId: string, text: string): void {
    this.appendDiscussionMessage(agentName, sessionId, 'user', text, true);
  }

  /** Append a streamed assistant-message chunk to the saved discussion transcript. */
  appendAssistantMessageChunk(agentName: string, sessionId: string, text: string): void {
    this.appendDiscussionMessage(agentName, sessionId, 'assistant', text, true);
  }

  /** Clear the saved discussion before rebuilding it from a session replay. */
  clearDiscussion(agentName: string, sessionId: string): void {
    const entry = this.get(agentName, sessionId);
    if (!entry?.discussion) { return; }
    delete entry.discussion;
    this.persist();
  }

  /** Build a compact discussion context suitable for sharing with another agent. */
  buildDiscussionContext(agentName: string, sessionId: string, maxChars: number = DEFAULT_CONTEXT_MAX_CHARS): string | null {
    const discussion = this.get(agentName, sessionId)?.discussion ?? [];
    const messages = discussion
      .filter(message => message.text.trim().length > 0)
      .slice(-MAX_DISCUSSION_MESSAGES);
    if (messages.length === 0) {
      return null;
    }

    const lines = messages.map(message => {
      const label = message.role === 'user' ? 'User' : 'Assistant';
      return `${label}: ${message.text.trim()}`;
    });
    const body = lines.join('\n\n');
    const trimmedBody = body.length > maxChars
      ? body.slice(body.length - maxChars)
      : body;

    return [
      'Previous ACP session discussion, shared so you can continue with context:',
      trimmedBody,
    ].join('\n\n');
  }

  /** Mark a target session as derived from a source session's context family. */
  linkContextFamily(
    sourceAgentName: string,
    sourceSessionId: string,
    targetAgentName: string,
    targetSessionId: string,
    workspace?: WorkspaceFilter,
  ): ContextFamilyInfo | null {
    if (sourceAgentName === targetAgentName && sourceSessionId === targetSessionId) {
      return null;
    }

    const source = this.get(sourceAgentName, sourceSessionId, workspace);
    const target = this.get(targetAgentName, targetSessionId, workspace);
    if (!source || !target) {
      return null;
    }

    const now = new Date().toISOString();
    const contextFamilyId = source.contextFamilyId ?? this.createContextFamilyId(now);
    source.contextFamilyId = contextFamilyId;
    source.contextLinkedAt ??= now;

    target.contextFamilyId = contextFamilyId;
    target.contextLinkedAt = now;
    target.contextLinkedFrom = {
      agentName: sourceAgentName,
      sessionId: sourceSessionId,
      createdAt: now,
    };

    this.persist();
    return this.getContextFamily(targetAgentName, targetSessionId, workspace);
  }

  /** Bump `lastActiveAt` to now and mark the local record available again. */
  touch(agentName: string, sessionId: string): void {
    const entry = this.get(agentName, sessionId);
    if (!entry) { return; }
    entry.status = 'available';
    entry.lastActiveAt = new Date().toISOString();
    this.persist();
  }

  markStatus(agentName: string, sessionId: string, status: PersistedSessionStatus): boolean {
    const entry = this.get(agentName, sessionId);
    if (!entry) { return false; }
    if (entry.status === status) { return true; }
    entry.status = status;
    entry.lastActiveAt = new Date().toISOString();
    this.persist();
    return true;
  }

  markAgentStatus(agentName: string, status: PersistedSessionStatus): number {
    let changed = 0;
    for (const entry of this.entries) {
      if (entry.agentName !== agentName || entry.status === status) {
        continue;
      }
      entry.status = status;
      entry.lastActiveAt = new Date().toISOString();
      changed += 1;
    }
    if (changed > 0) { this.persist(); }
    return changed;
  }

  /** Remove a single entry only after explicit user intent. */
  forget(agentName: string, sessionId: string): boolean {
    const before = this.entries.length;
    this.entries = this.entries.filter(
      e => !(e.agentName === agentName && e.sessionId === sessionId),
    );
    if (this.entries.length !== before) {
      this.persist();
      return true;
    }
    return false;
  }

  /** Remove every entry for an agent only after explicit user intent. */
  forgetAgent(agentName: string): number {
    const before = this.entries.length;
    this.entries = this.entries.filter(e => e.agentName !== agentName);
    const removed = before - this.entries.length;
    if (removed > 0) { this.persist(); }
    return removed;
  }

  /**
   * Reconcile against an agent-provided list. Unknown sessions are marked
   * missing instead of deleted so local history is not lost silently.
   */
  reconcileFromAgent(
    agentName: string,
    knownSessionIds: Set<string>,
    workspace?: WorkspaceFilter,
  ): void {
    const workspaceKey = workspaceKeyFromFilter(workspace);
    let changed = false;
    for (const entry of this.entries) {
      if (entry.agentName !== agentName) { continue; }
      if (workspaceKey && entry.workspaceKey !== workspaceKey && normalizeWorkspaceKey(entry.cwd) !== workspaceKey) {
        continue;
      }
      const nextStatus: PersistedSessionStatus = knownSessionIds.has(entry.sessionId)
        ? 'available'
        : 'missing';
      if (entry.status !== nextStatus) {
        entry.status = nextStatus;
        changed = true;
      }
    }
    if (changed) { this.persist(); }
  }

  private enforceCap(agentName: string, workspaceKey: string): void {
    const forAgentWorkspace = this.list(agentName, workspaceKey, {
      includeStatuses: ['available', 'missing', 'agentUnavailable', 'agentRemoved'],
    });
    if (forAgentWorkspace.length <= this.capPerAgentWorkspace) { return; }
    const surplus = forAgentWorkspace.slice(this.capPerAgentWorkspace);
    const stale = new Set(surplus.map(e => e.sessionId));
    this.entries = this.entries.filter(
      e => !(e.agentName === agentName && e.workspaceKey === workspaceKey && stale.has(e.sessionId)),
    );
  }

  private appendDiscussionMessage(
    agentName: string,
    sessionId: string,
    role: PersistedDiscussionMessage['role'],
    text: string,
    mergeWithPrevious: boolean,
  ): void {
    const entry = this.get(agentName, sessionId);
    if (!entry || text.length === 0) { return; }

    const discussion = entry.discussion ?? [];
    const last = discussion[discussion.length - 1];
    if (mergeWithPrevious && last?.role === role) {
      last.text = this.truncateDiscussionMessage(last.text + text);
    } else if (!mergeWithPrevious && last?.role === role && last.text === text) {
      return;
    } else {
      discussion.push({
        role,
        text: this.truncateDiscussionMessage(text),
      });
    }

    entry.discussion = discussion.slice(-MAX_DISCUSSION_MESSAGES);
    this.persist();
  }

  private truncateDiscussionMessage(text: string): string {
    return text.length > MAX_DISCUSSION_MESSAGE_LEN
      ? text.slice(text.length - MAX_DISCUSSION_MESSAGE_LEN)
      : text;
  }

  private createContextFamilyId(createdAt: string): string {
    return `ctx-${Date.parse(createdAt).toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  }

  private persist(fireEvent = true): void {
    const payload: PersistedShapeV2 = { version: 2, entries: this.entries };
    void this.workspaceState.update(STATE_KEY_V2, payload);
    if (fireEvent) {
      this._onDidChange.fire();
    }
  }

  dispose(): void {
    this._onDidChange.dispose();
  }
}

function migrateV1Entry(entry: PersistedSessionEntryV1): PersistedSessionEntry {
  const identity = workspaceIdentityFromCwd(entry.cwd || process.cwd());
  return {
    workspaceKey: identity.key,
    cwd: identity.cwd,
    agentName: entry.agentName,
    sessionId: entry.sessionId,
    title: entry.title,
    firstPrompt: entry.firstPrompt,
    createdAt: entry.createdAt,
    lastActiveAt: entry.lastActiveAt,
    status: 'available',
  };
}

function normalizeV2Entry(entry: PersistedSessionEntry): PersistedSessionEntry {
  const identity = workspaceIdentityFromCwd(entry.cwd || process.cwd());
  return {
    ...entry,
    workspaceKey: entry.workspaceKey || identity.key,
    cwd: entry.cwd || identity.cwd,
    status: isPersistedStatus(entry.status) ? entry.status : 'available',
  };
}

function isPersistedEntry(entry: PersistedSessionEntry): boolean {
  return Boolean(entry.agentName && entry.cwd && entry.sessionId && entry.workspaceKey);
}

function isPersistedStatus(value: unknown): value is PersistedSessionStatus {
  return value === 'available'
    || value === 'missing'
    || value === 'agentUnavailable'
    || value === 'agentRemoved';
}

function identityFromWorkspace(workspace: string | WorkspaceIdentity): WorkspaceIdentity {
  return typeof workspace === 'string' ? workspaceIdentityFromCwd(workspace) : workspace;
}

function workspaceKeyFromFilter(workspace: WorkspaceFilter): string | undefined {
  if (!workspace) { return undefined; }
  return typeof workspace === 'string'
    ? normalizeWorkspaceKey(workspace)
    : workspace.key;
}
