import * as assert from 'assert';

import { DebugTraceStore } from '../core/DebugTraceStore';

suite('DebugTraceStore', () => {
  test('keeps a FIFO event cap and counts dropped events', () => {
    const store = new DebugTraceStore({ maxEvents: 2, maxBytes: 1024 * 1024 });

    store.record({ category: 'traffic', method: 'one', payload: { id: 1 } });
    store.record({ category: 'traffic', method: 'two', payload: { id: 2 } });
    store.record({ category: 'traffic', method: 'three', payload: { id: 3 } });

    const snapshot = store.snapshot();
    assert.strictEqual(snapshot.eventCount, 2);
    assert.strictEqual(snapshot.droppedEvents, 1);
    assert.deepStrictEqual(snapshot.events.map(event => event.method), ['two', 'three']);
  });

  test('keeps a FIFO byte cap while preserving the newest event', () => {
    const store = new DebugTraceStore({ maxEvents: 100, maxBytes: 40 });

    store.record({ category: 'prompt', method: 'first', payload: { text: 'a'.repeat(30) } });
    store.record({ category: 'prompt', method: 'second', payload: { text: 'b'.repeat(30) } });

    const snapshot = store.snapshot();
    assert.strictEqual(snapshot.eventCount, 1);
    assert.strictEqual(snapshot.events[0].method, 'second');
    assert.strictEqual(snapshot.droppedEvents, 1);
  });

  test('serializes raw payload shapes that JSON cannot normally handle', () => {
    const store = new DebugTraceStore();
    const circular: any = { count: 1n };
    circular.self = circular;
    const error = new Error('boom');

    store.record({
      category: 'client-error',
      method: 'client/test',
      payload: {
        circular,
        error,
      },
    });

    const event = store.snapshot().events[0];
    const payload = event.payload as any;
    assert.strictEqual(payload.circular.count, '1n');
    assert.strictEqual(payload.circular.self, '[Circular]');
    assert.strictEqual(payload.error.name, 'Error');
    assert.strictEqual(payload.error.message, 'boom');
    assert.doesNotThrow(() => JSON.stringify(event));
  });

  test('returns immutable event copies in snapshots', () => {
    const store = new DebugTraceStore();
    const returnedEvent = store.record({
      category: 'traffic',
      method: 'original',
      payload: { nested: { value: 'original' } },
    });

    const first = store.snapshot();
    first.events[0].method = 'mutated';
    ((first.events[0].payload as any).nested as any).value = 'mutated';
    returnedEvent.method = 'mutated';

    const second = store.snapshot();
    assert.strictEqual(second.events[0].method, 'original');
    assert.strictEqual(((second.events[0].payload as any).nested as any).value, 'original');
  });
});
