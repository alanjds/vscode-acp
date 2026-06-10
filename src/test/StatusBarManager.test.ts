import * as assert from 'assert';
import { EventEmitter } from 'node:events';
import * as vscode from 'vscode';

import { StatusBarManager } from '../ui/StatusBarManager';

class FakeSessionManager extends EventEmitter {
  public activeSession: { agentDisplayName?: string } | undefined;
  public connectedAgents: string[] = [];

  getActiveSession() {
    return this.activeSession;
  }

  getConnectedAgentNames() {
    return this.connectedAgents;
  }
}

suite('StatusBarManager', () => {
  let originalCreateStatusBarItem: typeof vscode.window.createStatusBarItem;

  setup(() => {
    originalCreateStatusBarItem = vscode.window.createStatusBarItem;
  });

  teardown(() => {
    vscode.window.createStatusBarItem = originalCreateStatusBarItem;
  });

  test('shows disconnected state by default', () => {
    const fakeSessionManager = new FakeSessionManager();
    const item: any = {
      text: '',
      tooltip: '',
      backgroundColor: undefined,
      command: undefined,
      show: () => undefined,
      dispose: () => undefined,
    };

    vscode.window.createStatusBarItem = function() {
      return item;
    } as any;

    const manager = new StatusBarManager(fakeSessionManager as any);

    assert.strictEqual(item.command, 'acp.connectAgent');
    assert.strictEqual(item.text, '$(hubot) ACP: Disconnected');
    assert.strictEqual(item.tooltip, 'Click to connect to an agent');
    assert.strictEqual(item.backgroundColor, undefined);

    manager.dispose();
  });

  test('updates text and tooltip when connected', () => {
    const fakeSessionManager = new FakeSessionManager();
    fakeSessionManager.connectedAgents = ['Agent A'];
    fakeSessionManager.activeSession = { agentDisplayName: 'Agent Display' };

    const item: any = {
      text: '',
      tooltip: '',
      backgroundColor: undefined,
      command: undefined,
      show: () => undefined,
      dispose: () => undefined,
    };

    vscode.window.createStatusBarItem = function() {
      return item;
    } as any;

    const manager = new StatusBarManager(fakeSessionManager as any);
    fakeSessionManager.emit('agent-connected');

    assert.strictEqual(item.text, '$(hubot) ACP: Agent Display');
    assert.strictEqual(item.tooltip, 'Connected to Agent Display\n1 agent(s) connected');

    manager.dispose();
  });

  test('shows error state on agent-error event', () => {
    const fakeSessionManager = new FakeSessionManager();
    const item: any = {
      text: '',
      tooltip: '',
      backgroundColor: undefined,
      command: undefined,
      show: () => undefined,
      dispose: () => undefined,
    };

    vscode.window.createStatusBarItem = function() {
      return item;
    } as any;

    const manager = new StatusBarManager(fakeSessionManager as any);
    fakeSessionManager.emit('agent-error');

    assert.strictEqual(item.text, '$(error) ACP: Error');
    assert.ok(item.backgroundColor instanceof vscode.ThemeColor);

    manager.dispose();
  });
});