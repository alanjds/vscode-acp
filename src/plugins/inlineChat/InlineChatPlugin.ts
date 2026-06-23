import * as vscode from 'vscode';

import type { WorkspaceIdentity } from '../../core/WorkspaceIdentity';
import type { SessionManager } from '../../core/SessionManager';
import type { SandcastlePromotion } from '../../sandcastle/SandcastlePromotion';
import { DefaultEphemeralAgentRunner } from '../../core/EphemeralAgentRunner';
import { InlineChatController } from '../../inlineChat/InlineChatController';
import { SessionBackedActiveAgentResolver } from '../../inlineChat/agent/ActiveAgentResolver';
import { AcpInlineEditAgent } from '../../inlineChat/agent/AcpInlineEditAgent';
import type { FeaturePlugin } from '../FeaturePlugin';

export interface InlineChatPluginContext {
  extensionContext: vscode.ExtensionContext;
  sessionManager: SessionManager;
  workspaceIdentity: () => WorkspaceIdentity;
  sandcastlePromotion: SandcastlePromotion;
}

export class InlineChatPlugin implements FeaturePlugin<InlineChatPluginContext> {
  readonly id = 'inline-chat';

  activate(context: InlineChatPluginContext): vscode.Disposable {
    const activeAgentResolver = new SessionBackedActiveAgentResolver(
      () => context.workspaceIdentity().cwd,
      () => context.sessionManager.getActiveSession()?.agentName,
    );
    const controller = new InlineChatController(
      context.extensionContext,
      new AcpInlineEditAgent(
        context.workspaceIdentity,
        activeAgentResolver,
        new DefaultEphemeralAgentRunner(context.sandcastlePromotion),
      ),
    );
    const command = vscode.commands.registerCommand('damien.inlineChat.open', async () => {
      await controller.open();
    });

    return vscode.Disposable.from(command, controller);
  }
}

