import * as vscode from 'vscode';

import type { WorkspaceIdentity } from '../../core/WorkspaceIdentity';
import type { SessionManager } from '../../core/SessionManager';
import type { SandcastlePromotion } from '../../sandcastle/SandcastlePromotion';
import { InlineChatController } from '../../inlineChat/InlineChatController';
import { AcpInlineEditAgent } from '../../inlineChat/agent/AcpInlineEditAgent';
import { PatchApplyService } from '../../inlineChat/patch/PatchApplyService';
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
    const controller = new InlineChatController(
      context.extensionContext,
      new AcpInlineEditAgent(
        context.workspaceIdentity,
        context.sessionManager,
        context.sandcastlePromotion,
      ),
      new PatchApplyService(),
    );
    const command = vscode.commands.registerCommand('damien.inlineChat.open', async () => {
      await controller.open();
    });

    return vscode.Disposable.from(command, controller);
  }
}

