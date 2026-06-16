import * as vscode from 'vscode';

import { getSandboxConfig } from './SandboxConfig';
import type { SandboxContext } from './SandboxContext';
import { PromotionGate, type PromotionReport } from './PromotionGate';
import { SandboxApplyService } from './SandboxApplyService';
import { SandboxService } from './SandboxService';

export type SandboxPromotionOutcome = 'applied' | 'rejected' | 'cancelled';

export class SandboxPromotionPanel {
  constructor(
    private readonly sandboxService: SandboxService,
    private readonly promotionGate: PromotionGate = new PromotionGate(),
    private readonly applyService: SandboxApplyService = new SandboxApplyService(),
  ) {}

  async show(context: SandboxContext): Promise<SandboxPromotionOutcome> {
    const report = await this.promotionGate.evaluate(context);
    const config = getSandboxConfig();

    if (report.filesChanged === 0) {
      await this.sandboxService.destroy(context);
      void vscode.window.showInformationMessage('Sandbox run completed with no file changes.');
      return 'cancelled';
    }

    while (true) {
      const summary = this.buildSummary(report);
      const choice = await vscode.window.showInformationMessage(
        summary,
        { modal: true },
        'View Diff',
        'Apply',
        'Reject',
      );

      if (!choice) {
        return 'cancelled';
      }

      if (choice === 'View Diff') {
        await this.openDiffDocument(context, report);
        continue;
      }

      if (choice === 'Reject') {
        if (config.autoCleanupOnReject) {
          await this.sandboxService.destroy(context);
        }
        void vscode.window.showInformationMessage('Sandbox changes rejected.');
        return 'rejected';
      }

      if (config.promotion.requireChecksPass && !report.checksPassed) {
        const override = await vscode.window.showWarningMessage(
          'Sandbox checks did not pass. Apply anyway?',
          'Apply Anyway',
          'Cancel',
        );
        if (override !== 'Apply Anyway') {
          continue;
        }
      }

      const result = await this.applyService.apply(context, report);
      if (!result.success) {
        void vscode.window.showErrorMessage(result.message);
        continue;
      }

      await this.sandboxService.destroy(context);
      void vscode.window.showInformationMessage(result.message);
      return 'applied';
    }
  }

  private buildSummary(report: PromotionReport): string {
    const checkSummary = report.checks.length === 0
      ? 'No checks configured.'
      : report.checks
        .map(check => `${check.name}: ${check.success ? 'OK' : 'FAILED'}`)
        .join(', ');
    return `Sandbox ready for promotion — ${report.filesChanged} file(s) changed. ${checkSummary}`;
  }

  private async openDiffDocument(context: SandboxContext, report: PromotionReport): Promise<void> {
    const document = await vscode.workspace.openTextDocument({
      content: [
        `# Sandbox diff (${context.id})`,
        `# base: ${context.baseRef}`,
        '',
        report.diff || '(no diff)',
      ].join('\n'),
      language: 'diff',
    });
    await vscode.window.showTextDocument(document, {
      preview: true,
      viewColumn: vscode.ViewColumn.Beside,
    });
  }
}
