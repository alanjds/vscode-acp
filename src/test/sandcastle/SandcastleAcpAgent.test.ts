import * as assert from 'assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';

import type { AgentSideConnection } from '@agentclientprotocol/sdk';
import type {
  CreateSandboxOptions,
  Sandbox,
  SandboxRunOptions,
} from '@ai-hero/sandcastle';

import {
  SandcastleAcpAgent,
  type SandcastleRuntime,
} from '../../sandcastle/SandcastleAcpAgent';

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

class FakeConnection {
  readonly updates: any[] = [];

  async sessionUpdate(update: any): Promise<void> {
    this.updates.push(update);
  }
}

class FakeRuntime implements SandcastleRuntime {
  readonly prompts: string[] = [];
  waitForAbort = false;

  createProvider(): any {
    return {
      name: 'fake',
      env: {},
      captureSessions: false,
      buildPrintCommand: () => ({ command: 'true' }),
      parseStreamLine: () => [],
    };
  }

  createSandboxProvider(): any {
    return {};
  }

  async createSandbox(options: CreateSandboxOptions): Promise<Sandbox> {
    const repo = options.cwd!;
    const worktree = path.join(repo, '.sandcastle-test', options.branch.replaceAll('/', '-'));
    fs.mkdirSync(path.dirname(worktree), { recursive: true });
    git(repo, ['worktree', 'add', '-b', options.branch, worktree, options.baseBranch || 'HEAD']);

    return {
      branch: options.branch,
      worktreePath: worktree,
      run: async (runOptions: SandboxRunOptions) => {
        const prompt = runOptions.prompt || '';
        this.prompts.push(prompt);
        if (this.waitForAbort) {
          if (runOptions.signal?.aborted) {
            throw runOptions.signal.reason;
          }
          await new Promise<void>((resolve, reject) => {
            runOptions.signal?.addEventListener('abort', () => reject(runOptions.signal?.reason), { once: true });
          });
        }
        fs.writeFileSync(path.join(worktree, 'sentinel.txt'), prompt, 'utf8');
        if (runOptions.logging?.type === 'file') {
          runOptions.logging.onAgentStreamEvent?.({
            type: 'text',
            message: 'done',
            iteration: 1,
            timestamp: new Date(),
          });
        }
        return {
          iterations: [],
          stdout: 'done',
          commits: [],
        };
      },
      interactive: async () => ({ commits: [], exitCode: 0 }),
      close: async () => {
        git(repo, ['worktree', 'remove', '--force', worktree]);
        git(repo, ['branch', '-D', options.branch]);
        return {};
      },
      [Symbol.asyncDispose]: async () => undefined,
    };
  }
}

suite('SandcastleAcpAgent', () => {
  let repo: string;

  setup(() => {
    repo = fs.mkdtempSync(path.join(os.tmpdir(), 'sandcastle-acp-agent-'));
    git(repo, ['init']);
    git(repo, ['config', 'user.email', 'tests@example.com']);
    git(repo, ['config', 'user.name', 'ACP Tests']);
    fs.writeFileSync(path.join(repo, 'README.md'), '# Test\n', 'utf8');
    git(repo, ['add', '.']);
    git(repo, ['commit', '-m', 'initial']);
  });

  teardown(() => {
    fs.rmSync(repo, { recursive: true, force: true });
  });

  test('streams, previews and applies without touching the main worktree early', async () => {
    const connection = new FakeConnection();
    const runtime = new FakeRuntime();
    const agent = new SandcastleAcpAgent(connection as unknown as AgentSideConnection, {
      provider: 'codex', model: 'test', imageName: 'fake',
    }, runtime);
    const { sessionId } = await agent.newSession({ cwd: repo, mcpServers: [] });

    const result = await agent.prompt({
      sessionId,
      prompt: [{ type: 'text', text: 'make a change' }],
    });
    assert.strictEqual(result.stopReason, 'end_turn');
    assert.strictEqual(fs.existsSync(path.join(repo, 'sentinel.txt')), false);
    assert.ok(connection.updates.some(update => update.update.content?.text === 'done'));

    const preview = await agent.extMethod('sandcastle/preview', { sessionId });
    assert.strictEqual(preview.filesChanged, 1);
    const applied = await agent.extMethod('sandcastle/apply', { sessionId });
    assert.strictEqual(applied.success, true);
    assert.strictEqual(fs.readFileSync(path.join(repo, 'sentinel.txt'), 'utf8'), 'make a change');
    await agent.dispose();
  });

  test('rebuilds bounded history and rejects the next sandbox', async () => {
    const connection = new FakeConnection();
    const runtime = new FakeRuntime();
    const agent = new SandcastleAcpAgent(connection as unknown as AgentSideConnection, {
      provider: 'cursor', model: 'test', imageName: 'fake',
    }, runtime);
    const { sessionId } = await agent.newSession({ cwd: repo, mcpServers: [] });
    await agent.prompt({ sessionId, prompt: [{ type: 'text', text: 'first' }] });
    await agent.prompt({ sessionId, prompt: [{ type: 'text', text: 'second' }] });
    assert.ok(runtime.prompts[1].includes('User:\nfirst'));
    assert.ok(runtime.prompts[1].endsWith('second'));
    await agent.extMethod('sandcastle/reject', { sessionId });
    assert.strictEqual(fs.existsSync(path.join(repo, 'sentinel.txt')), false);
    await agent.dispose();
  });

  test('cancels an active run and refuses concurrent prompts', async () => {
    const connection = new FakeConnection();
    const runtime = new FakeRuntime();
    runtime.waitForAbort = true;
    const agent = new SandcastleAcpAgent(connection as unknown as AgentSideConnection, {
      provider: 'codex', model: 'test', imageName: 'fake',
    }, runtime);
    const { sessionId } = await agent.newSession({ cwd: repo, mcpServers: [] });
    const running = agent.prompt({ sessionId, prompt: [{ type: 'text', text: 'wait' }] });
    await assert.rejects(
      () => agent.prompt({ sessionId, prompt: [{ type: 'text', text: 'parallel' }] }),
      /already has a prompt/,
    );
    await agent.cancel({ sessionId });
    assert.strictEqual((await running).stopReason, 'cancelled');
    await agent.dispose();
  });
});
