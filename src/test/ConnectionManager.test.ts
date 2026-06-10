import * as assert from 'assert';

import { ConnectionManager } from '../core/ConnectionManager';

suite('ConnectionManager', () => {
  test('connect throws when process stdio is missing', async () => {
    const manager = new ConnectionManager({} as any);

    await assert.rejects(
      manager.connect('agent-1', {} as any, '/repo'),
      /missing stdio streams/,
    );
  });

  test('tapStream forwards outgoing and incoming chunks', async () => {
    const manager = new ConnectionManager({} as any);

    const upstream = new TransformStream<any, any>();
    const downstream = new TransformStream<any, any>();
    const originalStream = {
      writable: downstream.writable,
      readable: upstream.readable,
    };

    const tapped = (manager as any).tapStream(originalStream);

    const outReader = downstream.readable.getReader();
    const inWriter = tapped.writable.getWriter();
    await inWriter.write({ direction: 'send', value: 1 });
    const sent = await outReader.read();
    assert.deepStrictEqual(sent.value, { direction: 'send', value: 1 });
    await inWriter.close();
    outReader.releaseLock();

    const srcWriter = upstream.writable.getWriter();
    const tappedReader = tapped.readable.getReader();
    await srcWriter.write({ direction: 'recv', value: 2 });
    const recv = await tappedReader.read();
    assert.deepStrictEqual(recv.value, { direction: 'recv', value: 2 });
    await srcWriter.close();
    tappedReader.releaseLock();
  });

  test('removeConnection and dispose clear internal map', () => {
    const manager = new ConnectionManager({} as any);
    const info = { connection: {}, client: {}, initResponse: {} } as any;

    (manager as any).connections.set('a1', info);
    (manager as any).connections.set('a2', info);

    manager.removeConnection('a1');
    assert.strictEqual(manager.getConnection('a1'), undefined);
    assert.ok(manager.getConnection('a2'));

    manager.dispose();
    assert.strictEqual(manager.getConnection('a2'), undefined);
  });
});