import * as assert from 'assert';
import * as vscode from 'vscode';

import { PermissionHandler } from '../../handlers/PermissionHandler';

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
});
