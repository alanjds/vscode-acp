import * as assert from 'assert';
import * as vscode from 'vscode';

import {
  resolveAgent,
} from '../config/VirtualAgentCatalog';
import { SessionBackedActiveAgentResolver } from '../inlineChat/agent/ActiveAgentResolver';

suite('ActiveAgentResolver', () => {
  let originalGetConfiguration: typeof vscode.workspace.getConfiguration;

  setup(() => {
    originalGetConfiguration = vscode.workspace.getConfiguration;
    vscode.workspace.getConfiguration = function() {
      return {
        get: (key: string, defaultValue?: unknown) => {
          if (key === 'agents') {
            return {
              Codex: { command: 'echo', displayName: 'Codex Agent' },
              Vibe: { command: 'echo' },
            };
          }
          return defaultValue;
        },
      } as any;
    };
  });

  teardown(() => {
    vscode.workspace.getConfiguration = originalGetConfiguration;
  });

  test('active configured non-virtual agent resolves to itself', () => {
    const resolver = new SessionBackedActiveAgentResolver(
      () => '/repo',
      () => 'Codex',
    );
    const agent = resolver.resolveRunnableAgent();
    assert.strictEqual(agent.name, 'Codex');
    assert.strictEqual(agent.displayName, 'Codex Agent');
  });

  test('no active session falls back to first configured agent', () => {
    const resolver = new SessionBackedActiveAgentResolver(
      () => '/repo',
      () => undefined,
    );
    const agent = resolver.resolveRunnableAgent();
    assert.strictEqual(resolveAgent(agent.name, '/repo')?.kind, 'configured');
  });

  test('missing displayName falls back to agent name', () => {
    const resolver = new SessionBackedActiveAgentResolver(
      () => '/repo',
      () => 'Vibe',
    );
    const agent = resolver.resolveRunnableAgent();
    assert.strictEqual(agent.name, 'Vibe');
    assert.strictEqual(agent.displayName, 'Vibe');
  });
});
