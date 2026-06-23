import * as assert from 'assert';

import {
  isVirtualAgentName,
  listConfiguredAgentNames,
  listSelectableAgentNames,
  resolveAgent,
} from '../config/VirtualAgentCatalog';

suite('VirtualAgentCatalog', () => {
  const agentConfigs = {
    'Codex CLI': { command: 'codex' },
    Vibe: { command: 'vibe' },
  };

  test('resolveAgent returns configured agents', () => {
    const resolution = resolveAgent('Codex CLI', '/repo', agentConfigs as any);
    assert.strictEqual(resolution?.kind, 'configured');
    assert.strictEqual(resolution?.runnable, true);
  });

  test('listConfiguredAgentNames returns settings keys', () => {
    assert.deepStrictEqual(
      listConfiguredAgentNames(agentConfigs as any).sort(),
      ['Codex CLI', 'Vibe'],
    );
  });

  test('isVirtualAgentName is false for configured agents', () => {
    assert.strictEqual(isVirtualAgentName('Vibe', '/repo', agentConfigs as any), false);
  });

  test('listSelectableAgentNames includes configured agents', () => {
    const names = listSelectableAgentNames('/repo', agentConfigs as any);
    assert.ok(names.includes('Codex CLI'));
    assert.ok(names.includes('Vibe'));
  });
});
