import * as assert from 'assert';

import type { SessionInfo } from '../core/session/sessionTypes';
import {
  disconnectCurrentAgentIfNeeded,
  resumeExistingAgentSession,
} from '../core/session/sessionConnectShared';

suite('sessionConnectShared', () => {
  test('resumeExistingAgentSession returns cached session and activates it', () => {
    const session: SessionInfo = {
      sessionId: 's-1',
      agentId: 'a-1',
      agentName: 'Codex',
      agentDisplayName: 'Codex',
      cwd: '/repo',
      createdAt: 'now',
      initResponse: {} as SessionInfo['initResponse'],
      modes: null,
      models: null,
      configOptions: null,
      availableCommands: [],
      skillsBootstrapped: false,
    };

    const events: string[] = [];
    const sessionState = {
      getAgentSession: (name: string) => name === 'Codex' ? 's-1' : undefined,
      getSession: (id: string) => id === 's-1' ? session : undefined,
      setActiveSessionId: (id: string) => {
        events.push(`active:${id}`);
      },
    };

    const result = resumeExistingAgentSession(
      sessionState as any,
      (event, id) => {
        events.push(`${event}:${id}`);
        return true;
      },
      'Codex',
    );

    assert.strictEqual(result, session);
    assert.deepStrictEqual(events, ['active:s-1', 'active-session-changed:s-1']);
  });

  test('disconnectCurrentAgentIfNeeded disconnects active agent', async () => {
    const disconnected: string[] = [];
    const sessionState = {
      getActiveAgentName: () => 'Codex',
    };

    await disconnectCurrentAgentIfNeeded(
      sessionState as any,
      async (name) => {
        disconnected.push(name);
      },
    );

    assert.deepStrictEqual(disconnected, ['Codex']);
  });
});
