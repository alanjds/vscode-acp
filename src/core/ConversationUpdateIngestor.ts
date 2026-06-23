import type {
  AvailableCommand,
  SessionConfigOption,
  SessionNotification,
} from '@agentclientprotocol/sdk';

export interface SessionInfoUpdatePayload {
  title?: string | null;
  updatedAt?: string | null;
}

export interface ConversationUpdateEffects {
  sessionId: string;
  availableCommands?: AvailableCommand[];
  configOptions?: SessionConfigOption[] | null;
  sessionInfo?: SessionInfoUpdatePayload;
  assistantMessageChunk?: string;
  replayedUserMessageChunk?: string;
}

export interface ConversationUpdateProjection {
  sessionId: string;
  update: SessionNotification['update'];
  shouldForwardToActiveConversation: boolean;
}

export function collectConversationUpdateEffects(
  notification: SessionNotification,
  options: { isLoading: boolean },
): ConversationUpdateEffects {
  const update = notification.update as any;
  const effects: ConversationUpdateEffects = {
    sessionId: notification.sessionId,
  };

  if (update?.sessionUpdate === 'available_commands_update') {
    effects.availableCommands = Array.isArray(update.availableCommands)
      ? update.availableCommands
      : [];
  }

  if (update?.sessionUpdate === 'config_option_update') {
    effects.configOptions = Array.isArray(update.configOptions)
      ? update.configOptions
      : [];
  }

  if (update?.sessionUpdate === 'session_info_update') {
    effects.sessionInfo = {
      title: update.title,
      updatedAt: update.updatedAt,
    };
  }

  const text = textFromSessionUpdate(update);
  if (update?.sessionUpdate === 'agent_message_chunk' && text) {
    effects.assistantMessageChunk = text;
  }

  if (update?.sessionUpdate === 'user_message_chunk' && text && options.isLoading) {
    effects.replayedUserMessageChunk = text;
  }

  return effects;
}

export function projectConversationUpdate(
  notification: SessionNotification,
  activeSessionId: string | null,
): ConversationUpdateProjection {
  return {
    sessionId: notification.sessionId,
    update: notification.update,
    shouldForwardToActiveConversation: notification.sessionId === activeSessionId,
  };
}

function textFromSessionUpdate(updateData: any): string | null {
  const content = updateData?.content;
  return content?.type === 'text' && typeof content.text === 'string'
    ? content.text
    : null;
}
