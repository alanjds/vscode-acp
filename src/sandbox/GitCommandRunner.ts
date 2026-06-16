import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export interface GitCommandResult {
  stdout: string;
  stderr: string;
}

export interface GitCommandRunner {
  exec(cwd: string, args: string[]): Promise<GitCommandResult>;
}

export class DefaultGitCommandRunner implements GitCommandRunner {
  async exec(cwd: string, args: string[]): Promise<GitCommandResult> {
    const { stdout, stderr } = await execFileAsync('git', args, {
      cwd,
      maxBuffer: 10 * 1024 * 1024,
    });
    return {
      stdout: stdout.toString(),
      stderr: stderr.toString(),
    };
  }
}

export const defaultGitCommandRunner = new DefaultGitCommandRunner();
