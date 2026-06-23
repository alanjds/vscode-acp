import type { SessionNotification } from '@agentclientprotocol/sdk';

import {
  collectConversationUpdateEffects,
  projectConversationUpdate,
  type ConversationUpdateEffects,
} from './ConversationUpdateIngestor';
import type {
  PipelinePlanReadyEvent,
  PipelineSessionUpdateEvent,
  PipelineStatusEvent,
} from '../pipeline/PipelineEvents';

export type ConversationWebviewMessage =
  | {
      type: 'sessionUpdate';
      update: SessionNotification['update'];
      sessionId?: string;
      phase?: string;
      role?: string;
      agentName?: string;
      teamId?: string;
    }
  | {
      type: 'pipelinePlanReady';
      plan: string;
      role?: string;
      agentName?: string;
      teamId?: string;
      implementerUsesSandcastle?: boolean;
      revised?: boolean;
    }
  | {
      type: 'pipelineStatus';
      status?: string;
      message?: string;
      stepId?: string;
      role?: string;
      agentName?: string;
      teamId?: string;
      implementerUsesSandcastle?: boolean;
    };

export type AcpSessionUpdateInput = {
  kind: 'acp-session-update';
  notification: SessionNotification;
};

export type PipelineStatusInput = {
  kind: 'pipeline-status';
  event: PipelineStatusEvent;
};

export type PipelinePlanReadyInput = {
  kind: 'pipeline-plan-ready';
  event: PipelinePlanReadyEvent;
};

export type PipelineSessionUpdateInput = {
  kind: 'pipeline-session-update';
  event: PipelineSessionUpdateEvent;
};

export type ConversationProjectorInput =
  | AcpSessionUpdateInput
  | PipelineStatusInput
  | PipelinePlanReadyInput
  | PipelineSessionUpdateInput;

export type ConversationProjectorContext = {
  activeSessionId: string | null;
  isLoading: (sessionId: string) => boolean;
};

export type ConversationProjection = {
  sessionId: string;
  sessionEffects: ConversationUpdateEffects;
  webviewMessages: ConversationWebviewMessage[];
  shouldForwardToActiveConversation: boolean;
};

export interface ConversationProjector {
  project(
    input: ConversationProjectorInput,
    ctx: ConversationProjectorContext,
  ): ConversationProjection;
}

function assistantTextNotification(text: string, sessionId: string): SessionNotification {
  return {
    sessionId,
    update: {
      sessionUpdate: 'agent_message_chunk',
      content: { type: 'text', text },
    },
  } as SessionNotification;
}

function isActiveSession(sessionId: string, activeSessionId: string | null): boolean {
  return sessionId === activeSessionId;
}

export class DefaultConversationProjector implements ConversationProjector {
  project(
    input: ConversationProjectorInput,
    ctx: ConversationProjectorContext,
  ): ConversationProjection {
    switch (input.kind) {
      case 'acp-session-update':
        return this.projectAcpSessionUpdate(input.notification, ctx);
      case 'pipeline-session-update':
        return this.projectPipelineSessionUpdate(input.event, ctx);
      case 'pipeline-plan-ready':
        return this.projectPipelinePlanReady(input.event, ctx);
      case 'pipeline-status':
        return this.projectPipelineStatus(input.event, ctx);
    }
  }

  private projectAcpSessionUpdate(
    notification: SessionNotification,
    ctx: ConversationProjectorContext,
  ): ConversationProjection {
    const sessionEffects = collectConversationUpdateEffects(notification, {
      isLoading: ctx.isLoading(notification.sessionId),
    });
    const forward = projectConversationUpdate(notification, ctx.activeSessionId);

    return {
      sessionId: notification.sessionId,
      sessionEffects,
      webviewMessages: forward.shouldForwardToActiveConversation
        ? [{
            type: 'sessionUpdate',
            update: notification.update,
            sessionId: notification.sessionId,
          }]
        : [],
      shouldForwardToActiveConversation: forward.shouldForwardToActiveConversation,
    };
  }

  private projectPipelineSessionUpdate(
    event: PipelineSessionUpdateEvent,
    ctx: ConversationProjectorContext,
  ): ConversationProjection {
    const sessionEffects = collectConversationUpdateEffects(event.update, {
      isLoading: ctx.isLoading(event.sessionId),
    });
    const shouldForward = isActiveSession(event.sessionId, ctx.activeSessionId);

    return {
      sessionId: event.sessionId,
      sessionEffects,
      webviewMessages: shouldForward
        ? [{
            type: 'sessionUpdate',
            update: event.update.update,
            sessionId: event.sessionId,
            phase: event.phase,
            role: event.role,
            agentName: event.agentName,
            teamId: event.teamId,
          }]
        : [],
      shouldForwardToActiveConversation: shouldForward,
    };
  }

  private projectPipelinePlanReady(
    event: PipelinePlanReadyEvent,
    ctx: ConversationProjectorContext,
  ): ConversationProjection {
    const sessionEffects = event.plan
      ? collectConversationUpdateEffects(
          assistantTextNotification(event.plan, event.sessionId),
          { isLoading: ctx.isLoading(event.sessionId) },
        )
      : { sessionId: event.sessionId };
    const shouldForward = isActiveSession(event.sessionId, ctx.activeSessionId);

    return {
      sessionId: event.sessionId,
      sessionEffects,
      webviewMessages: shouldForward
        ? [{
            type: 'pipelinePlanReady',
            plan: event.plan,
            role: event.role,
            agentName: event.agentName,
            teamId: event.teamId,
            implementerUsesSandcastle: event.implementerUsesSandcastle,
            revised: event.revised === true,
          }]
        : [],
      shouldForwardToActiveConversation: shouldForward,
    };
  }

  private projectPipelineStatus(
    event: PipelineStatusEvent,
    ctx: ConversationProjectorContext,
  ): ConversationProjection {
    const shouldForward = isActiveSession(event.sessionId, ctx.activeSessionId);

    return {
      sessionId: event.sessionId,
      sessionEffects: { sessionId: event.sessionId },
      webviewMessages: shouldForward
        ? [{
            type: 'pipelineStatus',
            status: event.status,
            message: event.message,
            stepId: event.stepId,
            role: event.role,
            agentName: event.agentName,
            teamId: event.teamId,
            implementerUsesSandcastle: event.implementerUsesSandcastle,
          }]
        : [],
      shouldForwardToActiveConversation: shouldForward,
    };
  }
}
