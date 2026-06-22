import * as assert from 'assert';

import { parseBridgeConfig } from '../../sandcastle/BridgeConfig';

suite('BridgeConfig', () => {
  test('parses a Sandcastle provider and model', () => {
    const config = parseBridgeConfig(
      ['--provider', 'codex', '--model', 'gpt-test', '--effort', 'high'],
      { ACP_SANDCASTLE_IMAGE: 'test-image' },
    );
    assert.deepStrictEqual(config, {
      provider: 'codex',
      model: 'gpt-test',
      effort: 'high',
      imageName: 'test-image',
    });
  });

  test('rejects unsupported providers', () => {
    assert.throws(
      () => parseBridgeConfig(['--provider', 'other', '--model', 'x'], {}),
      /provider codex\|cursor/,
    );
  });
});
