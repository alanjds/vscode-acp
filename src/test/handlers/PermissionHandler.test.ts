import * as assert from 'assert';
import * as vscode from 'vscode';

import { PermissionHandler } from '../../handlers/PermissionHandler';

function makeParams(kind: string, options?: any[]) {
  return {
    sessionId: 'test-session-1',
    toolCall: { toolCallId: 'test-tool-1', title: 'Test Permission', kind: kind as any },
    options: options || [
      { optionId: 'allow_once', name: 'Allow once', kind: 'allow_once' as const },
      { optionId: 'deny', name: 'Deny', kind: 'reject_once' as const },
      { optionId: 'allow_always', name: 'Always allow', kind: 'allow_always' as const },
    ],
  };
}

suite('PermissionHandler', () => {
  let originalShowQuickPick: typeof vscode.window.showQuickPick;
  let originalGetConfiguration: typeof vscode.workspace.getConfiguration;

  setup(() => {
    originalShowQuickPick = vscode.window.showQuickPick;
    originalGetConfiguration = vscode.workspace.getConfiguration;
  });

  teardown(() => {
    vscode.window.showQuickPick = originalShowQuickPick;
    vscode.workspace.getConfiguration = originalGetConfiguration;
  });

  test('requests are queued and processed sequentially', async () => {
    const callOrder: number[] = [];
    const delays: number[] = [30, 10, 20]; // Different delays to verify ordering

    // Mock showQuickPick with sequential delays
    vscode.window.showQuickPick = async function(_items: any, _options: any) {
      const callIndex = callOrder.length;
      callOrder.push(callIndex);
      
      // Delay based on call index to ensure async behavior
      await new Promise(resolve => setTimeout(resolve, delays[callIndex] || 0));
      
      return {
        label: 'Allow',
        optionId: 'allow_once',
        description: 'allow_once'
      } as any;
    };

    // Mock getConfiguration to return no auto-approve (default 'ask')
    vscode.workspace.getConfiguration = function(_section) {
      return {
        get: (key: string) => {
          if (key.startsWith('autoApprove.')) {
            return 'ask';
          }
          return undefined;
        }
      } as any;
    };

    const handler = new PermissionHandler();
    
    const params = {
      sessionId: 'test-session-1',
      toolCall: { toolCallId: 'test-tool-1', title: 'Test Permission', kind: 'read' as const },
      options: [
        { optionId: 'allow_once', name: 'Allow once', kind: 'allow_once' as const },
        { optionId: 'deny', name: 'Deny', kind: 'reject_once' as const }
      ]
    };

    // Fire multiple requests concurrently
    const results = await Promise.all([
      handler.requestPermission(params),
      handler.requestPermission({...params, sessionId: 'test-session-2', toolCall: {...params.toolCall, toolCallId: 'test-tool-2'}}),
      handler.requestPermission({...params, sessionId: 'test-session-3', toolCall: {...params.toolCall, toolCallId: 'test-tool-3'}})
    ]);

    // All should be processed
    assert.strictEqual(results.length, 3);
    assert.strictEqual(results[0].outcome.outcome, 'selected');
    assert.strictEqual(results[1].outcome.outcome, 'selected');
    assert.strictEqual(results[2].outcome.outcome, 'selected');

    // Verify sequential processing: calls should complete in order 0, 1, 2
    // Even though call 1 has the shortest delay (10ms), it should still
    // wait for call 0 (30ms) to finish first
    assert.deepStrictEqual(callOrder, [0, 1, 2]);
  });

  test('autoApproveAll skips prompt for Sandcastle bridge connections', async () => {
    let promptCalled = false;

    vscode.window.showQuickPick = async function() {
      promptCalled = true;
      return undefined;
    };

    const handler = new PermissionHandler({ autoApproveAll: true });
    const result = await handler.requestPermission(makeParams('execute'));

    assert.strictEqual(promptCalled, false);
    assert.strictEqual(result.outcome.outcome, 'selected');
    assert.strictEqual((result.outcome as { optionId: string }).optionId, 'allow_once');
  });

  test('autoApprove with allow for read skips prompt', async () => {
    let promptCalled = false;

    vscode.window.showQuickPick = async function(_items: any, _options: any) {
      promptCalled = true;
      return undefined;
    };

    vscode.workspace.getConfiguration = function(_section) {
      return {
        get: (key: string) => {
          if (key === 'autoApprove.read') {
            return 'allow';
          }
          return undefined;
        }
      } as any;
    };

    const handler = new PermissionHandler();
    
    const params = {
      sessionId: 'test-session-1',
      toolCall: { toolCallId: 'test-tool-1', title: 'Test Permission', kind: 'read' as const },
      options: [
        { optionId: 'allow_once', name: 'Allow once', kind: 'allow_once' as const },
        { optionId: 'deny', name: 'Deny', kind: 'reject_once' as const },
        { optionId: 'allow_always', name: 'Always allow', kind: 'allow_always' as const }
      ]
    };

    const result = await handler.requestPermission(params);

    // Should not have shown prompt
    assert.strictEqual(promptCalled, false);
    // Should return first allow option
    assert.strictEqual(result.outcome.outcome, 'selected');
    assert.strictEqual(result.outcome.optionId, 'allow_once');
  });

  test('autoApprove with allow for edit skips prompt', async () => {
    let promptCalled = false;

    vscode.window.showQuickPick = async function(_items: any, _options: any) {
      promptCalled = true;
      return undefined;
    };

    vscode.workspace.getConfiguration = function(_section) {
      return {
        get: (key: string) => {
          if (key === 'autoApprove.edit') {
            return 'allow';
          }
          return undefined;
        }
      } as any;
    };

    const handler = new PermissionHandler();
    
    const params = {
      sessionId: 'test-session-1',
      toolCall: { toolCallId: 'test-tool-1', title: 'Test Permission', kind: 'edit' as const },
      options: [
        { optionId: 'allow_once', name: 'Allow once', kind: 'allow_once' as const },
        { optionId: 'deny', name: 'Deny', kind: 'reject_once' as const }
      ]
    };

    const result = await handler.requestPermission(params);

    assert.strictEqual(promptCalled, false);
    assert.strictEqual(result.outcome.outcome, 'selected');
    assert.strictEqual(result.outcome.optionId, 'allow_once');
  });

  test('autoApprove with allow for execute skips prompt', async () => {
    let promptCalled = false;

    vscode.window.showQuickPick = async function(_items: any, _options: any) {
      promptCalled = true;
      return undefined;
    };

    vscode.workspace.getConfiguration = function(_section) {
      return {
        get: (key: string) => {
          if (key === 'autoApprove.execute') {
            return 'allow';
          }
          return undefined;
        }
      } as any;
    };

    const handler = new PermissionHandler();
    
    const params = {
      sessionId: 'test-session-1',
      toolCall: { toolCallId: 'test-tool-1', title: 'Test Permission', kind: 'execute' as const },
      options: [
        { optionId: 'allow_once', name: 'Allow once', kind: 'allow_once' as const },
        { optionId: 'deny', name: 'Deny', kind: 'reject_once' as const }
      ]
    };

    const result = await handler.requestPermission(params);

    assert.strictEqual(promptCalled, false);
    assert.strictEqual(result.outcome.outcome, 'selected');
    assert.strictEqual(result.outcome.optionId, 'allow_once');
  });

  test('autoApprove with ask shows prompt', async () => {
    let promptCalled = false;

    vscode.window.showQuickPick = async function(_items: any, _options: any) {
      promptCalled = true;
      return {
        label: 'Allow',
        optionId: 'allow_once',
        description: 'allow_once'
      } as any;
    };

    vscode.workspace.getConfiguration = function(_section) {
      return {
        get: (key: string) => {
          if (key.startsWith('autoApprove.')) {
            return 'ask';
          }
          return undefined;
        }
      } as any;
    };

    const handler = new PermissionHandler();
    
    const params = {
      sessionId: 'test-session-1',
      toolCall: { toolCallId: 'test-tool-1', title: 'Test Permission', kind: 'read' as const },
      options: [
        { optionId: 'allow_once', name: 'Allow once', kind: 'allow_once' as const },
        { optionId: 'deny', name: 'Deny', kind: 'reject_once' as const }
      ]
    };

    const result = await handler.requestPermission(params);

    // Should have shown prompt
    assert.strictEqual(promptCalled, true);
    assert.strictEqual(result.outcome.outcome, 'selected');
    assert.strictEqual(result.outcome.optionId, 'allow_once');
  });

  test('permission prompt includes the requested command line in item details', async () => {
    let capturedItems: any[] | undefined;
    let capturedOptions: any | undefined;

    vscode.window.showQuickPick = async function(items: any, _options: any) {
      capturedItems = items;
      capturedOptions = _options;
      return {
        label: 'Allow',
        optionId: 'allow_once',
        description: 'allow_once'
      } as any;
    };

    vscode.workspace.getConfiguration = function(_section) {
      return {
        get: (key: string) => {
          if (key.startsWith('autoApprove.')) {
            return 'ask';
          }
          return undefined;
        }
      } as any;
    };

    const handler = new PermissionHandler();

    const params = {
      sessionId: 'test-session-1',
      toolCall: {
        toolCallId: 'test-tool-1',
        title: 'Execute command',
        kind: 'execute' as const,
        rawInput: 'npm run build -- --watch',
      },
      options: [
        { optionId: 'allow_once', name: 'Allow once', kind: 'allow_once' as const },
        { optionId: 'deny', name: 'Deny', kind: 'reject_once' as const }
      ]
    };

    const result = await handler.requestPermission(params);

    assert.strictEqual(result.outcome.outcome, 'selected');
    assert.ok(capturedItems);
    assert.strictEqual(capturedOptions?.placeHolder, 'Execute command - npm run build -- --watch');
    assert.strictEqual(capturedItems?.[0].description, 'allow_once - npm run build -- --watch');
    assert.strictEqual(capturedItems?.[1].description, 'reject_once - npm run build -- --watch');
  });

  test('cancelled permission returns cancelled outcome', async () => {
    vscode.window.showQuickPick = async function(_items: any, _options: any) {
      return undefined; // User cancelled
    };

    vscode.workspace.getConfiguration = function(_section) {
      return {
        get: (key: string) => {
          if (key.startsWith('autoApprove.')) {
            return 'ask';
          }
          return undefined;
        }
      } as any;
    };

    const handler = new PermissionHandler();
    
    const params = {
      sessionId: 'test-session-1',
      toolCall: { toolCallId: 'test-tool-1', title: 'Test Permission', kind: 'read' as const },
      options: [
        { optionId: 'allow_once', name: 'Allow once', kind: 'allow_once' as const },
        { optionId: 'deny', name: 'Deny', kind: 'reject_once' as const }
      ]
    };

    const result = await handler.requestPermission(params);

    assert.strictEqual(result.outcome.outcome, 'cancelled');
  });

  test('selecting an option returns selected outcome with optionId', async () => {
    vscode.window.showQuickPick = async function(_items: any, _options: any) {
      return {
        label: 'Allow',
        optionId: 'allow_once',
        description: 'allow_once'
      } as any;
    };

    vscode.workspace.getConfiguration = function(_section) {
      return {
        get: (key: string) => {
          if (key.startsWith('autoApprove.')) {
            return 'ask';
          }
          return undefined;
        }
      } as any;
    };

    const handler = new PermissionHandler();
    
    const params = {
      sessionId: 'test-session-1',
      toolCall: { toolCallId: 'test-tool-1', title: 'Test Permission', kind: 'read' as const },
      options: [
        { optionId: 'allow_once', name: 'Allow once', kind: 'allow_once' as const },
        { optionId: 'deny', name: 'Deny', kind: 'reject_once' as const }
      ]
    };

    const result = await handler.requestPermission(params);

    assert.strictEqual(result.outcome.outcome, 'selected');
    assert.strictEqual(result.outcome.optionId, 'allow_once');
  });

  test('autoApprove selects allow_always over allow_once', async () => {
    vscode.window.showQuickPick = async function(_items: any, _options: any) {
      throw new Error('should not be called');
    };

    vscode.workspace.getConfiguration = function(_section) {
      return {
        get: (key: string) => {
          if (key === 'autoApprove.edit') {
            return 'allow';
          }
          return undefined;
        }
      } as any;
    };

    const handler = new PermissionHandler();
    
    const params = {
      sessionId: 'test-session-1',
      toolCall: { toolCallId: 'test-tool-1', title: 'Test Permission', kind: 'edit' as const },
      options: [
        { optionId: 'deny', name: 'Deny', kind: 'reject_once' as const },
        { optionId: 'allow_always', name: 'Always allow', kind: 'allow_always' as const },
        { optionId: 'allow_once', name: 'Allow once', kind: 'allow_once' as const }
      ]
    };

    const result = await handler.requestPermission(params);

    // Should return the first allow option found (allow_always comes before allow_once in the array)
    assert.strictEqual(result.outcome.outcome, 'selected');
    assert.strictEqual(result.outcome.optionId, 'allow_always');
  });

  // ============ New tests for search/fetch ============

  test('search uses autoApprove.read', async () => {
    let promptCalled = false;

    vscode.window.showQuickPick = async function(_items: any, _options: any) {
      promptCalled = true;
      return undefined;
    };

    vscode.workspace.getConfiguration = function(_section) {
      return {
        get: (key: string) => {
          if (key === 'autoApprove.read') {
            return 'allow';
          }
          return undefined;
        }
      } as any;
    };

    const handler = new PermissionHandler();
    const params = makeParams('search');

    const result = await handler.requestPermission(params);

    assert.strictEqual(promptCalled, false);
    assert.strictEqual(result.outcome.outcome, 'selected');
    assert.strictEqual(result.outcome.optionId, 'allow_once');
  });

  test('fetch uses autoApprove.read', async () => {
    let promptCalled = false;

    vscode.window.showQuickPick = async function(_items: any, _options: any) {
      promptCalled = true;
      return undefined;
    };

    vscode.workspace.getConfiguration = function(_section) {
      return {
        get: (key: string) => {
          if (key === 'autoApprove.read') {
            return 'allow';
          }
          return undefined;
        }
      } as any;
    };

    const handler = new PermissionHandler();
    const params = makeParams('fetch');

    const result = await handler.requestPermission(params);

    assert.strictEqual(promptCalled, false);
    assert.strictEqual(result.outcome.outcome, 'selected');
    assert.strictEqual(result.outcome.optionId, 'allow_once');
  });

  test('delete uses autoApprove.edit', async () => {
    let promptCalled = false;

    vscode.window.showQuickPick = async function(_items: any, _options: any) {
      promptCalled = true;
      return undefined;
    };

    vscode.workspace.getConfiguration = function(_section) {
      return {
        get: (key: string) => {
          if (key === 'autoApprove.edit') {
            return 'allow';
          }
          return undefined;
        }
      } as any;
    };

    const handler = new PermissionHandler();
    const params = makeParams('delete');

    const result = await handler.requestPermission(params);

    assert.strictEqual(promptCalled, false);
    assert.strictEqual(result.outcome.outcome, 'selected');
    assert.strictEqual(result.outcome.optionId, 'allow_once');
  });

  test('move uses autoApprove.edit', async () => {
    let promptCalled = false;

    vscode.window.showQuickPick = async function(_items: any, _options: any) {
      promptCalled = true;
      return undefined;
    };

    vscode.workspace.getConfiguration = function(_section) {
      return {
        get: (key: string) => {
          if (key === 'autoApprove.edit') {
            return 'allow';
          }
          return undefined;
        }
      } as any;
    };

    const handler = new PermissionHandler();
    const params = makeParams('move');

    const result = await handler.requestPermission(params);

    assert.strictEqual(promptCalled, false);
    assert.strictEqual(result.outcome.outcome, 'selected');
    assert.strictEqual(result.outcome.optionId, 'allow_once');
  });

  // ============ Unknown kind tests ============

  test('unknown kind ignores autoApprove read/edit/execute and shows QuickPick', async () => {
    let promptCalled = false;

    vscode.window.showQuickPick = async function(_items: any, _options: any) {
      promptCalled = true;
      return {
        label: 'Allow',
        optionId: 'allow_once',
        description: 'allow_once',
      } as any;
    };

    vscode.workspace.getConfiguration = function(_section) {
      return {
        get: (key: string) => {
          if (key.startsWith('autoApprove.')) {
            return 'allow';
          }
          return undefined;
        }
      } as any;
    };

    const handler = new PermissionHandler();
    const params = makeParams('unknown_kind');

    const result = await handler.requestPermission(params);

    assert.strictEqual(promptCalled, true);
    assert.strictEqual(result.outcome.outcome, 'selected');
    assert.strictEqual(result.outcome.optionId, 'allow_once');
  });

  // ============ Auto-approve edge cases ============

  test('autoApprove.read = allow but no allow_once/allow_always option shows QuickPick', async () => {
    let promptCalled = false;

    vscode.window.showQuickPick = async function(_items: any, _options: any) {
      promptCalled = true;
      return {
        label: 'Deny',
        optionId: 'deny',
        description: 'deny',
      } as any;
    };

    vscode.workspace.getConfiguration = function(_section) {
      return {
        get: (key: string) => {
          if (key === 'autoApprove.read') {
            return 'allow';
          }
          return undefined;
        }
      } as any;
    };

    const handler = new PermissionHandler();
    const params = makeParams('read', [
      { optionId: 'deny', name: 'Deny', kind: 'reject_once' as const },
    ]);

    const result = await handler.requestPermission(params);

    assert.strictEqual(promptCalled, true);
    assert.strictEqual(result.outcome.outcome, 'selected');
    assert.strictEqual(result.outcome.optionId, 'deny');
  });

  test('autoApprove.edit = allow but no allow_once/allow_always option shows QuickPick', async () => {
    let promptCalled = false;

    vscode.window.showQuickPick = async function(_items: any, _options: any) {
      promptCalled = true;
      return {
        label: 'Deny',
        optionId: 'deny',
        description: 'deny',
      } as any;
    };

    vscode.workspace.getConfiguration = function(_section) {
      return {
        get: (key: string) => {
          if (key === 'autoApprove.edit') {
            return 'allow';
          }
          return undefined;
        }
      } as any;
    };

    const handler = new PermissionHandler();
    const params = makeParams('edit', [
      { optionId: 'deny', name: 'Deny', kind: 'reject_once' as const },
    ]);

    const result = await handler.requestPermission(params);

    assert.strictEqual(promptCalled, true);
    assert.strictEqual(result.outcome.outcome, 'selected');
    assert.strictEqual(result.outcome.optionId, 'deny');
  });

  // ============ QuickPick form tests ============

  test('showQuickPick rejection returns cancelled and queue continues', async () => {
    let callCount = 0;

    vscode.window.showQuickPick = async function(_items: any, _options: any) {
      callCount++;
      if (callCount === 1) {
        throw new Error('User cancelled');
      }
      return {
        label: 'Allow',
        optionId: 'allow_once',
        description: 'allow_once',
      } as any;
    };

    vscode.workspace.getConfiguration = function(_section) {
      return {
        get: (key: string) => {
          if (key.startsWith('autoApprove.')) {
            return 'ask';
          }
          return undefined;
        }
      } as any;
    };

    const handler = new PermissionHandler();
    const params = makeParams('read');

    // First request should fail but return cancelled
    const result1 = await handler.requestPermission(params);
    assert.strictEqual(result1.outcome.outcome, 'cancelled');

    // Second request should succeed
    const result2 = await handler.requestPermission({ ...params, sessionId: 'test-session-2' });
    assert.strictEqual(result2.outcome.outcome, 'selected');
    assert.strictEqual(result2.outcome.optionId, 'allow_once');
  });

  test('QuickPick items have correct form: allow prefixed by check, reject by x, description equals kind, optionId preserved', async () => {
    let promptItems: any[] = [];

    vscode.window.showQuickPick = async function(items: any, _options: any) {
      promptItems = items;
      return {
        label: 'Allow',
        optionId: 'allow_once',
        description: 'allow_once',
      } as any;
    };

    vscode.workspace.getConfiguration = function(_section) {
      return {
        get: (key: string) => {
          if (key.startsWith('autoApprove.')) {
            return 'ask';
          }
          return undefined;
        }
      } as any;
    };

    const handler = new PermissionHandler();
    const params = makeParams('read', [
      { optionId: 'allow_once', name: 'Allow once', kind: 'allow_once' as const },
      { optionId: 'allow_always', name: 'Always allow', kind: 'allow_always' as const },
      { optionId: 'deny', name: 'Deny', kind: 'reject_once' as const },
    ]);

    await handler.requestPermission(params);

    assert.strictEqual(promptItems.length, 3);

    // Check allow options have $(check) prefix
    const allowOnceItem = promptItems.find(i => i.optionId === 'allow_once');
    assert.ok(allowOnceItem);
    assert.ok(allowOnceItem.label.includes('$(check)'));
    assert.strictEqual(allowOnceItem.description, 'allow_once');

    const allowAlwaysItem = promptItems.find(i => i.optionId === 'allow_always');
    assert.ok(allowAlwaysItem);
    assert.ok(allowAlwaysItem.label.includes('$(check)'));
    assert.strictEqual(allowAlwaysItem.description, 'allow_always');

    // Check reject option has $(x) prefix
    const denyItem = promptItems.find(i => i.optionId === 'deny');
    assert.ok(denyItem);
    assert.ok(denyItem.label.includes('$(x)'));
    assert.strictEqual(denyItem.description, 'reject_once');
  });

  // ============ Queue continuation tests ============

  test('queue continues processing after showQuickPick rejection', async () => {
    let callCount = 0;
    const callOrder: string[] = [];

    vscode.window.showQuickPick = async function(_items: any, _options: any) {
      const callIndex = ++callCount;
      callOrder.push(`call-${callIndex}`);
      if (callIndex === 1) {
        return undefined; // Reject first call
      }
      return {
        label: 'Allow',
        optionId: 'allow_once',
        description: 'allow_once',
      } as any;
    };

    vscode.workspace.getConfiguration = function(_section) {
      return {
        get: (key: string) => {
          if (key.startsWith('autoApprove.')) {
            return 'ask';
          }
          return undefined;
        }
      } as any;
    };

    const handler = new PermissionHandler();
    const params = makeParams('read');

    const results = await Promise.all([
      handler.requestPermission(params),
      handler.requestPermission({ ...params, sessionId: 'test-session-2' }),
      handler.requestPermission({ ...params, sessionId: 'test-session-3' }),
    ]);

    // First should be cancelled
    assert.strictEqual(results[0].outcome.outcome, 'cancelled');
    // Others should succeed
    assert.strictEqual(results[1].outcome.outcome, 'selected');
    assert.strictEqual(results[2].outcome.outcome, 'selected');
    // Verify order: all calls processed sequentially
    assert.deepStrictEqual(callOrder, ['call-1', 'call-2', 'call-3']);
  });
});
