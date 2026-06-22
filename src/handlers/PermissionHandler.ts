import * as vscode from 'vscode';
import { log } from '../utils/Logger';
import { sendEvent } from '../utils/TelemetryManager';

import type { RequestPermissionRequest, RequestPermissionResponse } from '@agentclientprotocol/sdk';

const CANCELLED: RequestPermissionResponse = { outcome: { outcome: 'cancelled' } };

/**
 * Handles ACP permission requests from agents.
 * Uses a serial promise queue to prevent concurrent QuickPick dialogs.
 * Supports granular auto-approve by tool kind.
 */
export interface PermissionHandlerOptions {
  /** Auto-approve all ACP permission requests (used for Sandcastle bridge connections). */
  autoApproveAll?: boolean;
}

export class PermissionHandler {
  private queue: Promise<void> = Promise.resolve();

  constructor(private readonly options: PermissionHandlerOptions = {}) {}

  async requestPermission(params: RequestPermissionRequest): Promise<RequestPermissionResponse> {
    const result = this.queue.then(() => this.handlePermission(params));
    this.queue = result.then(() => {}, () => {});
    return result.catch((err) => {
      log(`Permission request failed: ${err}`);
      sendEvent('permission/responded', { permissionType: params.toolCall?.title || 'Permission Request', outcome: 'error' });
      return CANCELLED;
    });
  }

  private async handlePermission(params: RequestPermissionRequest): Promise<RequestPermissionResponse> {
    const title = params.toolCall?.title || 'Permission Request';
    const kind = params.toolCall?.kind;
    const detail = formatToolCallDetail(params.toolCall?.rawInput);

    if (this.options.autoApproveAll) {
      const allowOption = params.options.find(o =>
        o.kind === 'allow_once' || o.kind === 'allow_always',
      );
      if (allowOption) {
        sendEvent('permission/requested', { permissionType: title, autoApproved: 'true' });
        return {
          outcome: { outcome: 'selected', optionId: allowOption.optionId },
        };
      }
    }

    const config = vscode.workspace.getConfiguration('acp');
    // Granular auto-approve by tool kind
    let autoApprove: string;
    switch (kind) {
      case 'read':
      case 'search':
      case 'fetch':
        autoApprove = config.get<string>('autoApprove.read', 'ask');
        break;
      case 'edit':
      case 'delete':
      case 'move':
        autoApprove = config.get<string>('autoApprove.edit', 'ask');
        break;
      case 'execute':
        autoApprove = config.get<string>('autoApprove.execute', 'ask');
        break;
      default:
        autoApprove = 'ask';
        break;
    }

    log(`requestPermission: ${title} (kind=${kind}, autoApprove=${autoApprove})`);

    if (autoApprove === 'allow') {
      const allowOption = params.options.find(o =>
        o.kind === 'allow_once' || o.kind === 'allow_always'
      );
      if (allowOption) {
        sendEvent('permission/requested', { permissionType: title, autoApproved: 'true' });
        return {
          outcome: { outcome: 'selected', optionId: allowOption.optionId },
        };
      }
    }

    // QuickPick UI for manual approval
    const items: (vscode.QuickPickItem & { optionId: string })[] = params.options.map(option => {
      const icon = option.kind.startsWith('allow') ? '$(check)' : '$(x)';
      return {
        label: `${icon} ${option.name}`,
        description: formatPermissionDescription(option.kind, detail),
        optionId: option.optionId,
      };
    });

    sendEvent('permission/requested', { permissionType: title, autoApproved: 'false' });

    const selection = await vscode.window.showQuickPick(items, {
      placeHolder: detail ? `${title} - ${detail}` : title,
      title: 'ACP Agent Permission Request',
      ignoreFocusOut: true,
    });

    if (!selection) {
      log('Permission cancelled by user');
      sendEvent('permission/responded', { permissionType: title, outcome: 'cancelled' });
      return CANCELLED;
    }

    log(`Permission selected: ${selection.optionId}`);
    sendEvent('permission/responded', {
      permissionType: title,
      action: selection.optionId,
      outcome: 'selected',
    });
    return {
      outcome: { outcome: 'selected', optionId: selection.optionId },
    };
  }
}

function formatToolCallDetail(rawInput: unknown): string | undefined {
  if (rawInput === null || rawInput === undefined || rawInput === '') {
    return undefined;
  }

  const normalized = typeof rawInput === 'string'
    ? rawInput
    : (() => {
        try {
          return JSON.stringify(rawInput);
        } catch {
          return String(rawInput);
        }
      })();

  const trimmed = normalized.trim();
  if (!trimmed) {
    return undefined;
  }

  const maxLength = 180;
  return trimmed.length > maxLength ? `${trimmed.slice(0, maxLength - 3)}...` : trimmed;
}

function formatPermissionDescription(kind: string | undefined, detail: string | undefined): string {
  if (kind && detail) {
    return `${kind} - ${detail}`;
  }

  return detail || kind || '';
}
