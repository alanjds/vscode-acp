import * as assert from 'assert';

import { activateFeaturePlugins } from '../plugins/FeaturePluginRegistry';
import type { FeaturePlugin } from '../plugins/FeaturePlugin';

suite('FeaturePluginRegistry', () => {
  test('activates once and disposes plugins once in reverse order', () => {
    const events: string[] = [];
    const plugin = (id: string): FeaturePlugin<undefined> => ({
      id,
      activate: () => {
        events.push(`activate:${id}`);
        return { dispose: () => events.push(`dispose:${id}`) };
      },
    });
    const registry = activateFeaturePlugins([
      { plugin: plugin('one'), context: undefined },
      { plugin: plugin('two'), context: undefined },
    ]);

    registry.dispose();
    registry.dispose();

    assert.deepStrictEqual(events, ['activate:one', 'activate:two', 'dispose:two', 'dispose:one']);
  });

  test('rolls back activated plugins when activation fails', () => {
    const events: string[] = [];
    const first: FeaturePlugin<undefined> = {
      id: 'first',
      activate: () => ({ dispose: () => events.push('dispose:first') }),
    };
    const failing: FeaturePlugin<undefined> = {
      id: 'failing',
      activate: () => { throw new Error('activation failed'); },
    };

    assert.throws(() => activateFeaturePlugins([
      { plugin: first, context: undefined },
      { plugin: failing, context: undefined },
    ]), /activation failed/);
    assert.deepStrictEqual(events, ['dispose:first']);
  });

  test('rejects duplicate plugin ids', () => {
    const plugin: FeaturePlugin<undefined> = {
      id: 'duplicate',
      activate: () => ({ dispose: () => undefined }),
    };
    assert.throws(() => activateFeaturePlugins([
      { plugin, context: undefined },
      { plugin, context: undefined },
    ]), /registered more than once/);
  });
});
