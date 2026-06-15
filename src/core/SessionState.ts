import type { SessionInfo } from './SessionManager';

/**
 * Discovery flags for an agent, derived from `initialize.agentCapabilities`.
 */
export interface AgentCapabilitySummary {
  list: boolean;
  load: boolean;
  resume: boolean;
}

/**
 * Manages session state: the maps of sessions, agent→session mapping,
 * active session tracking, and capability caching.
 */
export class SessionState {
  private sessions: Map<string, SessionInfo> = new Map();
  private activeSessionId: string | null = null;
  private agentSessions: Map<string, string> = new Map();
  private capabilities: Map<string, AgentCapabilitySummary> = new Map();
  private loadingSessionIds: Set<string> = new Set();

  // --- Session Map ---

  addSession(sessionInfo: SessionInfo): void {
    this.sessions.set(sessionInfo.sessionId, sessionInfo);
  }

  getSession(sessionId: string): SessionInfo | undefined {
    return this.sessions.get(sessionId);
  }

  deleteSession(sessionId: string): boolean {
    return this.sessions.delete(sessionId);
  }

  getAllSessions(): Map<string, SessionInfo> {
    return new Map(this.sessions);
  }

  // --- Active Session ---

  setActiveSessionId(sessionId: string | null): void {
    this.activeSessionId = sessionId;
  }

  getActiveSessionId(): string | null {
    return this.activeSessionId;
  }

  getActiveSession(): SessionInfo | undefined {
    if (!this.activeSessionId) {
      return undefined;
    }
    return this.sessions.get(this.activeSessionId);
  }

  getActiveAgentName(): string | null {
    return this.getActiveSession()?.agentName ?? null;
  }

  // --- Agent→Session Mapping ---

  getAgentSession(agentName: string): string | undefined {
    return this.agentSessions.get(agentName);
  }

  setAgentSession(agentName: string, sessionId: string): void {
    this.agentSessions.set(agentName, sessionId);
  }

  deleteAgentSession(agentName: string): boolean {
    return this.agentSessions.delete(agentName);
  }

  isAgentConnected(agentName: string): boolean {
    return this.agentSessions.has(agentName);
  }

  getConnectedAgentNames(): string[] {
    return Array.from(this.agentSessions.keys());
  }

  // --- Capabilities Cache ---

  getCachedCapabilities(agentName: string): AgentCapabilitySummary | undefined {
    return this.capabilities.get(agentName);
  }

  setCapabilities(agentName: string, caps: AgentCapabilitySummary): void {
    this.capabilities.set(agentName, caps);
  }

  summarizeCapabilities(caps: any): AgentCapabilitySummary {
    const sc: any = caps?.sessionCapabilities;
    return {
      list: !!sc?.list,
      load: !!caps?.loadSession,
      resume: !!sc?.resume,
    };
  }

  // --- Loading State ---

  markLoading(sessionId: string): void {
    this.loadingSessionIds.add(sessionId);
  }

  unmarkLoading(sessionId: string): void {
    this.loadingSessionIds.delete(sessionId);
  }

  isLoading(sessionId: string): boolean {
    return this.loadingSessionIds.has(sessionId);
  }

  // --- Pipeline Check ---

  isPipelineSession(sessionId: string | null | undefined): boolean {
    if (!sessionId) {
      return false;
    }
    const session = this.sessions.get(sessionId);
    if (!session) {
      return false;
    }
    return (
      session.agentId.startsWith('pipeline_agent_') ||
      session.agentName.startsWith('pipeline/') ||
      session.agentName === 'pipeline-planner'
    );
  }

  // --- Cleanup ---

  dispose(): void {
    this.sessions.clear();
    this.agentSessions.clear();
    this.capabilities.clear();
    this.loadingSessionIds.clear();
  }
}
