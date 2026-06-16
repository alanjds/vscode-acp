import { exec } from 'node:child_process';
import { promisify } from 'node:util';

import { getSandboxConfig } from './SandboxConfig';
import type { SandboxContext } from './SandboxContext';
import { defaultGitCommandRunner, type GitCommandRunner } from './GitCommandRunner';

const execAsync = promisify(exec);

export interface PromotionCheckResult {
  name: string;
  success: boolean;
  output: string;
}

export interface PromotionReport {
  diff: string;
  filesChanged: number;
  checks: PromotionCheckResult[];
  checksPassed: boolean;
}

export class PromotionGate {
  constructor(private readonly git: GitCommandRunner = defaultGitCommandRunner) {}

  async evaluate(context: SandboxContext): Promise<PromotionReport> {
    const { diff, filesChanged } = await this.collectDiff(context);
    const checks = await this.runChecks(context);
    const checksPassed = checks.length === 0 || checks.every(check => check.success);
    return {
      diff,
      filesChanged,
      checks,
      checksPassed,
    };
  }

  async collectDiff(context: SandboxContext): Promise<{ diff: string; filesChanged: number }> {
    // `git diff <base>` ignores untracked files; intent-to-add includes created files without staging content.
    await this.git.exec(context.root, ['add', '--intent-to-add', '--', '.']);
    const { stdout: diff } = await this.git.exec(context.root, ['diff', '--binary', context.baseRef]);
    const { stdout: names } = await this.git.exec(context.root, [
      'diff',
      '--name-only',
      context.baseRef,
    ]);
    const filesChanged = names
      .split('\n')
      .map(line => line.trim())
      .filter(Boolean).length;
    return { diff, filesChanged };
  }

  async runChecks(context: SandboxContext): Promise<PromotionCheckResult[]> {
    const { promotion } = getSandboxConfig();
    const checks: PromotionCheckResult[] = [];

    if (promotion.lintCommand.trim()) {
      checks.push(await this.runCommand('lint', promotion.lintCommand, context.root));
    }
    if (promotion.testCommand.trim()) {
      checks.push(await this.runCommand('test', promotion.testCommand, context.root));
    }

    return checks;
  }

  private async runCommand(
    name: string,
    command: string,
    cwd: string,
  ): Promise<PromotionCheckResult> {
    try {
      const { stdout, stderr } = await execAsync(command, {
        cwd,
        maxBuffer: 10 * 1024 * 1024,
        shell: process.platform === 'win32' ? 'cmd.exe' : '/bin/sh',
      });
      return {
        name,
        success: true,
        output: `${stdout}\n${stderr}`.trim(),
      };
    } catch (error: any) {
      const output = [
        error?.stdout?.toString?.() ?? '',
        error?.stderr?.toString?.() ?? '',
        error?.message ?? String(error),
      ].join('\n').trim();
      return {
        name,
        success: false,
        output,
      };
    }
  }
}
