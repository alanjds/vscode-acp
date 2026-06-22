import * as assert from 'assert';
import { RequestError } from '@agentclientprotocol/sdk';

import { classifyAgentError, formatAgentErrorMessage } from '../../core/AgentError';

suite('AgentError', () => {
  test('formatAgentErrorMessage prefers RequestError data.details over Internal error', () => {
    const error = new RequestError(-32603, 'Internal error', {
      details: "You've hit your usage limit.",
    });
    assert.strictEqual(formatAgentErrorMessage(error), "You've hit your usage limit.");
  });

  test('classifyAgentError tags provider quota failures', () => {
    const classified = classifyAgentError(new RequestError(-32603, 'Internal error', {
      details: "You've hit your usage limit.",
    }));
    assert.strictEqual(classified.kind, 'provider-quota');
    assert.match(classified.actionHint, /codex\/settings\/usage/i);
  });
});
