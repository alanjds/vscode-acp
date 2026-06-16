import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import type { SandboxContext } from './SandboxContext';
import { defaultGitCommandRunner, type GitCommandRunner } from './GitCommandRunner';
import type { PromotionReport } from './PromotionGate';

export interface SandboxApplyResult {
  success: boolean;
  message: string;
}

export class SandboxApplyService {
  constructor(private readonly git: GitCommandRunner = defaultGitCommandRunner) {}

  async apply(context: SandboxContext, report: PromotionReport): Promise<SandboxApplyResult> {
    if (!report.diff.trim()) {
      return {
        success: true,
        message: 'No changes to apply.',
      };
    }

    const patchPath = path.join(os.tmpdir(), `acp-sandbox-${context.id}.patch`);
    fs.writeFileSync(patchPath, report.diff, 'utf8');

    try {
      await this.git.exec(context.baseCwd, ['apply', '--check', patchPath]);
      await this.git.exec(context.baseCwd, ['apply', patchPath]);
      return {
        success: true,
        message: `Applied sandbox changes (${report.filesChanged} file(s)).`,
      };
    } catch (error: any) {
      const message = error?.stderr?.toString?.() || error?.message || String(error);
      return {
        success: false,
        message: `Failed to apply sandbox changes: ${message}`,
      };
    } finally {
      try {
        fs.unlinkSync(patchPath);
      } catch {
        // Ignore cleanup errors.
      }
    }
  }
}
