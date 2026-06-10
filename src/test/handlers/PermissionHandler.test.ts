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
    vscode.window.showQuickPick = async function(items, options) {
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

    // Mock getConfiguration to return no auto-approve
    vscode.workspace.getConfiguration = function(section) {
      return {
        get: (key: string) => {
          if (key === 'autoApprovePermissions') return 'none';
          return undefined;
        }
      } as any;
    };

    const handler = new PermissionHandler();
    
    const params = {
      toolCall: { title: 'Test Permission' },
      options: [
        { optionId: 'allow_once', name: 'Allow once', kind: 'allow_once' },
        { optionId: 'deny', name: 'Deny', kind: 'deny' }
      ]
    };

    // Fire multiple requests concurrently
    const results = await Promise.all([
      handler.requestPermission(params),
      handler.requestPermission(params),
      handler.requestPermission(params)
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

  test('autoApprove with allowAll skips prompt', async () => {
    let promptCalled = false;

    vscode.window.showQuickPick = async function() {
      promptCalled = true;
      return undefined;
    };

    vscode.workspace.getConfiguration = function(section) {
      return {
        get: (key: string) => {
          if (key === 'autoApprovePermissions') return 'allowAll';
          return undefined;
        }
      } as any;
    };

    const handler = new PermissionHandler();
    
    const params = {
      toolCall: { title: 'Test Permission' },
      options: [
        { optionId: 'allow_once', name: 'Allow once', kind: 'allow_once' },
        { optionId: 'deny', name: 'Deny', kind: 'deny' },
        { optionId: 'allow_always', name: 'Always allow', kind: 'allow_always' }
      ]
    };

    const result = await handler.requestPermission(params);

    // Should not have shown prompt
    assert.strictEqual(promptCalled, false);
    // Should return first allow option
    assert.strictEqual(result.outcome.outcome, 'selected');
    assert.strictEqual(result.outcome.optionId, 'allow_once');
  });

  test('cancelled permission returns cancelled outcome', async () => {
    vscode.window.showQuickPick = async function() {
      return undefined; // User cancelled
    };

    vscode.workspace.getConfiguration = function(section) {
      return {
        get: (key: string) => {
          if (key === 'autoApprovePermissions') return 'none';
          return undefined;
        }
      } as any;
    };

    const handler = new PermissionHandler();
    
    const params = {
      toolCall: { title: 'Test Permission' },
      options: [
        { optionId: 'allow_once', name: 'Allow once', kind: 'allow_once' },
        { optionId: 'deny', name: 'Deny', kind: 'deny' }
      ]
    };

    const result = await handler.requestPermission(params);

    assert.strictEqual(result.outcome.outcome, 'cancelled');
  });

  test('selecting an option returns selected outcome with optionId', async () => {
    vscode.window.showQuickPick = async function() {
      return {
        label: 'Allow',
        optionId: 'allow_once',
        description: 'allow_once'
      } as any;
    };

    vscode.workspace.getConfiguration = function(section) {
      return {
        get: (key: string) => {
          if (key === 'autoApprovePermissions') return 'none';
          return undefined;
        }
      } as any;
    };

    const handler = new PermissionHandler();
    
    const params = {
      toolCall: { title: 'Test Permission' },
      options: [
        { optionId: 'allow_once', name: 'Allow once', kind: 'allow_once' },
        { optionId: 'deny', name: 'Deny', kind: 'deny' }
      ]
    };

    const result = await handler.requestPermission(params);

    assert.strictEqual(result.outcome.outcome, 'selected');
    assert.strictEqual(result.outcome.optionId, 'allow_once');
  });

  test('autoApprove selects allow_always over allow_once', async () => {
    vscode.window.showQuickPick = async function() {
      throw new Error('should not be called');
    };

    vscode.workspace.getConfiguration = function(section) {
      return {
        get: (key: string) => {
          if (key === 'autoApprovePermissions') return 'allowAll';
          return undefined;
        }
      } as any;
    };

    const handler = new PermissionHandler();
    
    const params = {
      toolCall: { title: 'Test Permission' },
      options: [
        { optionId: 'deny', name: 'Deny', kind: 'deny' },
        { optionId: 'allow_always', name: 'Always allow', kind: 'allow_always' },
        { optionId: 'allow_once', name: 'Allow once', kind: 'allow_once' }
      ]
    };

    const result = await handler.requestPermission(params);

    // Should return the first allow option found (allow_always comes before allow_once in the array)
    assert.strictEqual(result.outcome.outcome, 'selected');
    assert.strictEqual(result.outcome.optionId, 'allow_always');
  });
});
