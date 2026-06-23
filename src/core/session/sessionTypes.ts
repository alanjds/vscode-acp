import type {
  InitializeResponse,
  SessionModeState,
  SessionModelState,
  AvailableCommand,
  SessionConfigOption,
} from '@agentclientprotocol/sdk';

export interface SessionInfo {
  sessionId: string;
  agentId: string;
  agentName: string;
  agentDisplayName: string;
  cwd: string;
  createdAt: string;
  initResponse: InitializeResponse;
  modes: SessionModeState | null;
  models: SessionModelState | null;
  /**
   * Generic session config options (ACP "Session Config Options" — supersedes
   * `modes` / `models`). `null` means the agent did not provide this field.
   * Per spec, when both `configOptions` and `modes` are present, clients
   * should use `configOptions` exclusively.
   */
  configOptions: SessionConfigOption[] | null;
  availableCommands: AvailableCommand[];
  /** Latest title supplied via `session_info_update`, if any. */
  title?: string;
  /** Identifies sessions whose conversation lifecycle is owned by a plugin. */
  transport?: 'acp' | 'virtual';
  /** Whether the skills catalog was injected for this session. */
  skillsBootstrapped?: boolean;
}

export interface OpenSessionOptions {
  shareCurrentContext?: boolean;
}

export interface OpenedSession {
  session: SessionInfo;
  historyReplayed: boolean;
}
