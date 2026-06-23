import * as assert from 'assert';

import type { SessionNotification } from '@agentclientprotocol/sdk';

import type { AgentConfigEntry } from '../config/AgentConfig';
import { defaultGitCommandRunner } from '../git/GitCommandRunner';
import type { PipelineExecutor } from '../pipeline/PipelineExecutor';
import { TeamReviewerRerun } from '../pipeline/TeamReviewerRerun';
import type { TeamRunSnapshot } from '../pipeline/TeamRunSnapshotStore';
import { repoRoot } from './repoRoot';

suite('TeamReviewerRerun', () => {
  const snapshot: TeamRunSnapshot = {
    sessionId: 'session-1',
    teamId: 'feature-team',
    teamTitle: 'Feature Team',
    approvedPlan: '<proposed_plan>plan</proposed_plan>',
    implementOutput: 'implemented',
    completedAt: new Date().toISOString(),
  };

  const agentConfigs = {
    'Cursor CLI': { command: 'echo' },
    Vibe: { command: 'echo' },
    'Cursor Sandcastle': { transport: 'sandcastle', provider: 'cursor', model: 'composer-2' },
  };

  function createExecutor(
    runAgent: PipelineExecutor['runAgent'],
  ): PipelineExecutor {
    return { runAgent } as PipelineExecutor;
  }

  test('rerun invokes executor and emits reviewer-rerun session updates', async () => {
    const originalExec = defaultGitCommandRunner.exec.bind(defaultGitCommandRunner);
    defaultGitCommandRunner.exec = async () => ({ stdout: 'diff --git a/foo.ts', stderr: '' });

    const emitted: Array<{ phase: string; sessionId: string }> = [];
    const executor = createExecutor(async (_agentName, _prompt, options = {}) => {
      options.onSessionUpdate?.({
        sessionId: snapshot.sessionId,
        update: { sessionUpdate: 'agent_message_chunk' },
      } as SessionNotification);
      return 'review ok';
    });

    try {
      const rerun = new TeamReviewerRerun({
        workspaceCwd: () => repoRoot(),
        readAgentConfigs: () => agentConfigs,
        executor,
        emitSessionUpdate: event => {
          emitted.push({ phase: event.phase, sessionId: event.sessionId });
        },
      });

      const output = await rerun.rerun(snapshot, 'Feature Team');
      assert.strictEqual(output, 'review ok');
      assert.ok(emitted.length > 0);
      assert.strictEqual(emitted[0]?.phase, 'reviewer-rerun');
      assert.strictEqual(emitted[0]?.sessionId, 'session-1');
    } finally {
      defaultGitCommandRunner.exec = originalExec;
    }
  });

  test('cancel aborts in-flight rerun', async () => {
    const originalExec = defaultGitCommandRunner.exec.bind(defaultGitCommandRunner);
    defaultGitCommandRunner.exec = async () => ({ stdout: '', stderr: '' });

    let started = false;
    const executor = createExecutor(async (_agentName, _prompt, options = {}) => {
      started = true;
      return new Promise((_resolve, reject) => {
        const signal = options.signal;
        if (!signal) {
          reject(new Error('expected abort signal'));
          return;
        }
        const onAbort = () => reject(signal.reason ?? new Error('aborted'));
        if (signal.aborted) {
          onAbort();
          return;
        }
        signal.addEventListener('abort', onAbort, { once: true });
      });
    });

    const rerun = new TeamReviewerRerun({
      workspaceCwd: () => repoRoot(),
      readAgentConfigs: () => agentConfigs,
      executor,
      emitSessionUpdate: () => {},
    });

    try {
      const promise = rerun.rerun(snapshot, 'Feature Team');
      while (!started) {
        await new Promise(resolve => setTimeout(resolve, 5));
      }
      rerun.cancel();
      await assert.rejects(() => promise);
    } finally {
      defaultGitCommandRunner.exec = originalExec;
    }
  });

  test('missing team metadata throws', async () => {
    const rerun = new TeamReviewerRerun({
      workspaceCwd: () => repoRoot(),
      readAgentConfigs: () => agentConfigs,
      executor: createExecutor(async () => 'unused'),
      emitSessionUpdate: () => {},
    });

    await assert.rejects(
      () => rerun.rerun(snapshot, 'Unknown Team'),
      /not available/i,
    );
  });
});
