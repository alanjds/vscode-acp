import * as assert from 'assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import {
  enrichProviderRunError,
  extractCodexRolloutError,
  parseCodexJsonStreamErrors,
  readLatestCodexRolloutError,
} from '../../sandcastle/ProviderRunError';

suite('ProviderRunError', () => {
  test('parseCodexJsonStreamErrors surfaces turn.failed messages', () => {
    const text = [
      'Reading prompt from stdin...',
      '{"type":"turn.started"}',
      '{"type":"turn.failed","error":{"message":"You\'ve hit your usage limit."}}',
    ].join('\n');
    assert.strictEqual(parseCodexJsonStreamErrors(text), "You've hit your usage limit.");
  });

  test('extractCodexRolloutError detects zero-credit completions', () => {
    const rollout = [
      '{"type":"event_msg","payload":{"type":"token_count","rate_limits":{"credits":{"has_credits":false,"balance":"0"}}}}',
      '{"type":"event_msg","payload":{"type":"task_complete","last_agent_message":null}}',
    ].join('\n');
    const message = extractCodexRolloutError(rollout);
    assert.ok(message);
    assert.match(message!, /usage limit/i);
  });

  test('enrichProviderRunError replaces noisy sandcastle stderr', () => {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'provider-run-error-'));
    const sessionsDir = path.join(repo, '.sandcastle', 'codex-home', 'sessions', '2026', '06', '22');
    fs.mkdirSync(sessionsDir, { recursive: true });
    fs.writeFileSync(path.join(sessionsDir, 'rollout-test.jsonl'), [
      '{"type":"event_msg","payload":{"type":"token_count","rate_limits":{"credits":{"has_credits":false,"balance":"0"}}}}',
      '{"type":"event_msg","payload":{"type":"task_complete","last_agent_message":null}}',
    ].join('\n'), 'utf8');

    const error = enrichProviderRunError(
      new Error('codex exited with code 1:\nReading prompt from stdin...\n'),
      { provider: 'codex', cwd: repo },
    );
    assert.match(error.message, /usage limit/i);
    assert.doesNotMatch(error.message, /Reading prompt from stdin/i);

    fs.rmSync(repo, { recursive: true, force: true });
  });

  test('readLatestCodexRolloutError returns undefined when no sessions exist', () => {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'provider-run-error-empty-'));
    assert.strictEqual(readLatestCodexRolloutError(repo), undefined);
    fs.rmSync(repo, { recursive: true, force: true });
  });
});
