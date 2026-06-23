import type { FileSearchResult } from '../chatTypes';
import type { HostToWebviewMessage } from '../vscode';
import {
  normalizeConfigOptions,
  normalizeModelsState,
  normalizeModesState,
  normalizeSessionSnapshot,
  normalizeSessionUpdate,
} from './normalizers';
import {
  mapOrchestrationMessageToActions,
  mapSessionOrchestrationMetaToActions,
  normalizePipelinePhase,
  shouldFinalizeTeamRoleTurn,
  type OrchestrationHostMessage,
} from './orchestrationEvents';
import { resolveTeamTimeline } from './OrchestrationProjector';
import { mapSessionUpdateToActions } from './sessionUpdates';
import type { AppAction, AppState } from './state/types';
import { shouldAcceptIncomingOrchestrationState } from '../../../src/ui/OrchestrationStateCore';
import { shouldAcceptIncomingSharedState } from '../../../src/ui/ChatWebviewSharedStateCore';
import type { ChatWebviewSharedState } from '../chatTypes';
import type { OrchestrationState } from '../../../src/ui/OrchestrationState';

export type HostMessageRouterUiEffectRefs = {
  sharedVersionRef: { current: number };
  sharedUpdatedAtRef: { current: number };
  orchestrationVersionRef: { current: number };
  orchestrationUpdatedAtRef: { current: number };
  skipSharedSyncRef: { current: boolean };
  skipOrchestrationSyncRef: { current: boolean };
  turnCounterRef: { current: number };
  fileSearchRequestIdRef: { current: number };
};

export type HostMessageRouterUiEffects = {
  fileResults?: FileSearchResult[];
  fileSelectedIdx?: number;
  nextTurnCounter?: number;
  skipSharedSync?: boolean;
  skipOrchestrationSync?: boolean;
  nextSharedVersion?: number;
  nextSharedUpdatedAt?: number;
  nextOrchestrationVersion?: number;
  nextOrchestrationUpdatedAt?: number;
};

export function applyHostMessageRouterUiEffects(
  ui: HostMessageRouterUiEffects | undefined,
  refs: HostMessageRouterUiEffectRefs,
  setFileResults: (results: FileSearchResult[]) => void,
  setFileSelectedIdx: (idx: number) => void,
): void {
  if (!ui) {
    return;
  }

  if (ui.nextSharedVersion !== undefined) {
    refs.sharedVersionRef.current = ui.nextSharedVersion;
  }
  if (ui.nextSharedUpdatedAt !== undefined) {
    refs.sharedUpdatedAtRef.current = ui.nextSharedUpdatedAt;
  }
  if (ui.nextOrchestrationVersion !== undefined) {
    refs.orchestrationVersionRef.current = ui.nextOrchestrationVersion;
  }
  if (ui.nextOrchestrationUpdatedAt !== undefined) {
    refs.orchestrationUpdatedAtRef.current = ui.nextOrchestrationUpdatedAt;
  }
  if (ui.skipSharedSync) {
    refs.skipSharedSyncRef.current = true;
  }
  if (ui.skipOrchestrationSync) {
    refs.skipOrchestrationSyncRef.current = true;
  }
  if (ui.nextTurnCounter !== undefined) {
    refs.turnCounterRef.current = ui.nextTurnCounter;
  }
  if (ui.fileResults) {
    setFileResults(ui.fileResults);
    setFileSelectedIdx(ui.fileSelectedIdx ?? 0);
  }
}
export type HostMessageRouterRefs = {
  sharedVersion: number;
  sharedUpdatedAt: number;
  orchestrationVersion: number;
  orchestrationUpdatedAt: number;
  fileSearchRequestId: number;
  turnCounter: number;
};

export type HostMessageRouteResult = {
  actions: AppAction[];
  ui?: HostMessageRouterUiEffects;
};

export type HostMessageRouterContext = {
  getState: () => AppState;
  refs: HostMessageRouterRefs;
};

export function routeHostMessage(
  message: HostToWebviewMessage,
  ctx: HostMessageRouterContext,
): HostMessageRouteResult {
  const actions: AppAction[] = [];
  const ui: HostMessageRouterUiEffects = {};
  const state = ctx.getState();
  const refs = ctx.refs;

  switch (message.type) {
    case 'hydrateSharedState':
    case 'sharedStateUpdated':
      if (message.state && typeof message.state === 'object') {
        const sharedState = message.state as ChatWebviewSharedState;
        if (shouldAcceptIncomingSharedState(
          { version: refs.sharedVersion, updatedAt: refs.sharedUpdatedAt },
          sharedState,
        )) {
          ui.skipSharedSync = true;
          ui.nextSharedVersion = sharedState.version;
          ui.nextSharedUpdatedAt = sharedState.updatedAt;
          actions.push({ type: 'hydrateSharedState', state: sharedState });
        }
      }
      break;

    case 'hydrateOrchestrationState':
    case 'orchestrationStateUpdated':
      if (message.state && typeof message.state === 'object') {
        const orchestrationState = message.state as OrchestrationState;
        if (shouldAcceptIncomingOrchestrationState(
          { version: refs.orchestrationVersion, updatedAt: refs.orchestrationUpdatedAt },
          orchestrationState,
        )) {
          ui.skipOrchestrationSync = true;
          ui.nextOrchestrationVersion = orchestrationState.version;
          ui.nextOrchestrationUpdatedAt = orchestrationState.updatedAt;
          actions.push({ type: 'hydrateOrchestrationState', state: orchestrationState });
        }
      }
      break;

    case 'state':
      if (message.session) {
        actions.push({
          type: 'showSessionConnected',
          session: normalizeSessionSnapshot(message.session) ?? {},
        });
      } else {
        actions.push({ type: 'showNoSession' });
      }
      break;

    case 'externalUserMessage':
      if (typeof message.text === 'string') {
        actions.push({ type: 'appendUserMessage', text: message.text });
      }
      break;

    case 'fileSearchResults':
      if (
        typeof message.requestId === 'number' &&
        message.requestId === refs.fileSearchRequestId &&
        Array.isArray(message.results)
      ) {
        ui.fileResults = message.results.filter((result): result is FileSearchResult =>
          typeof result?.path === 'string' && typeof result?.name === 'string',
        );
        ui.fileSelectedIdx = 0;
      }
      break;

    case 'promptStart':
      ui.nextTurnCounter = refs.turnCounter + 1;
      actions.push({
        type: 'promptStart',
        turnId: `turn-${Date.now()}-${ui.nextTurnCounter}`,
      });
      break;

    case 'promptEnd':
      if (shouldFinalizeTeamRoleTurn(
        state.orchestration.activeRole,
        state.currentTurn?.assistantText,
      )) {
        actions.push({ type: 'finalizeTeamRoleTurn' });
      } else {
        actions.push({ type: 'promptEnd' });
      }
      break;

    case 'clearChat':
      actions.push({ type: 'clearChat' });
      break;

    case 'error':
      actions.push({
        type: 'appendErrorMessage',
        text: typeof message.message === 'string' ? message.message : 'An error occurred',
      });
      break;

    case 'info':
      actions.push({
        type: 'appendInfoMessage',
        text: typeof message.message === 'string' ? message.message : 'Information',
      });
      break;

    case 'pipelinePlanReady':
    case 'pipelinePlanApprovalFailed':
    case 'pipelineStatus':
    case 'reviewerRerunReady':
      actions.push(...mapOrchestrationMessageToActions(
        message as OrchestrationHostMessage,
        resolveTeamTimeline(state.orchestration.timeline),
      ));
      break;

    case 'sessionUpdate':
      actions.push(...mapSessionUpdateToActions(
        normalizeSessionUpdate(message.update),
        normalizePipelinePhase(message.phase ?? message.role),
      ));
      actions.push(...mapSessionOrchestrationMetaToActions(
        normalizePipelinePhase(message.role ?? message.phase),
        typeof message.agentName === 'string' ? message.agentName : undefined,
      ));
      break;

    case 'modesUpdate': {
      const modes = normalizeModesState(message.modes);
      if (modes) {
        actions.push({ type: 'updateModes', modes });
      }
      break;
    }

    case 'modelsUpdate': {
      const models = normalizeModelsState(message.models);
      if (models) {
        actions.push({ type: 'updateModels', models });
      }
      break;
    }

    case 'configOptionsUpdate':
      actions.push({
        type: 'updateConfigOptions',
        configOptions: normalizeConfigOptions(message.configOptions),
      });
      break;

    case 'loadSessionStart':
      actions.push({ type: 'loadSessionStart' });
      break;

    case 'loadSessionEnd':
      actions.push({ type: 'loadSessionEnd', ok: Boolean(message.ok) });
      break;

    case 'sessionInfoUpdate':
      actions.push({
        type: 'updateSessionTitle',
        title: typeof message.title === 'string' ? message.title : null,
      });
      break;
  }

  return ui && Object.keys(ui).length > 0 ? { actions, ui } : { actions };
}
