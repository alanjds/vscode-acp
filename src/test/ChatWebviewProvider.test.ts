import * as assert from 'assert';
import * as path from 'path';
import * as vscode from 'vscode';

import { ChatWebviewProvider } from '../ui/ChatWebviewProvider';
import type { EditorContext } from '../ui/EditorContext';

suite('ChatWebviewProvider', () => {
  const workspaceRoot = path.join(path.parse(process.cwd()).root, 'workspace');
  const examplePath = path.join(workspaceRoot, 'src', 'example.ts');

  async function createProvider(editorContext: EditorContext | null = null) {
    const sentPrompts: string[] = [];
    const recordedPrompts: string[] = [];
    const messages: any[] = [];
    const touchedSessions: string[] = [];
    const sessions = new Map<string, any>([
      ['session-1', {
        sessionId: 'session-1',
        agentDisplayName: 'agent-1',
        title: undefined,
        cwd: workspaceRoot,
        modes: null,
        models: null,
        configOptions: null,
        availableCommands: [],
      }],
    ]);

    const sessionManager = {
      sessions,
      getActiveSessionId: () => 'session-1',
      getActiveAgentName: () => 'agent-1',
      getSession: (sessionId: string) => sessions.get(sessionId),
      getSessionContextFamily: () => null,
      hasPendingSharedDiscussionContext: () => false,
      recordFirstPrompt: (_sessionId: string, prompt: string) => {
        recordedPrompts.push(prompt);
      },
      recordUserMessage: () => undefined,
      recordUserMessageChunk: () => undefined,
      recordAssistantMessageChunk: () => undefined,
      sendPrompt: async (_sessionId: string, prompt: string) => {
        sentPrompts.push(prompt);
        return { stopReason: 'end_turn' };
      },
      touchHistory: (sessionId: string) => {
        touchedSessions.push(sessionId);
      },
      appliedCommands: null as any,
      applyAvailableCommands: function(sessionId: string, commands: any) {
        this.appliedCommands = commands;
        const session = (this as any).sessions?.get(sessionId);
        if (session) {
          session.availableCommands = commands;
        }
      },
      appliedConfigOptions: null as any,
      applyConfigOptions: function(sessionId: string, options: any) {
        this.appliedConfigOptions = options;
        const session = (this as any).sessions?.get(sessionId);
        if (session) {
          session.configOptions = options;
        }
      },
      appliedSessionInfo: null as any,
      applySessionInfoUpdate: function(sessionId: string, info: any) {
        this.appliedSessionInfo = info;
        const session = (this as any).sessions?.get(sessionId);
        if (session) {
          session.title = info.title;
        }
      },
      isPipelineSession: () => false,
      isLoading: () => false,
      getConnectedAgentNames: () => ['agent-1'],
    };
    const sessionUpdateHandler = {
      addListener: () => undefined,
      removeListener: () => undefined,
    };
    let messageHandler: (m: any) => Promise<void> = async () => {};
    const provider = new ChatWebviewProvider(
      vscode.Uri.file(workspaceRoot),
      sessionManager as any,
      sessionUpdateHandler as any,
      () => editorContext,
    );

    (provider as any).view = {
      webview: {
        asWebviewUri: (uri: vscode.Uri) => uri,
        cspSource: 'csp-source',
        postMessage: (message: any) => {
          messages.push(message);
          return Promise.resolve(true);
        },
        onDidReceiveMessage: (handler: any) => {
          messageHandler = handler;
          return { dispose: () => {} };
        },
      },
    };
    (provider as any).isViewReady = true;

    // Trigger registration by calling resolveWebviewView
    const mockWebviewView = {
      webview: (provider as any).view.webview,
      onDidDispose: () => ({ dispose: () => {} }),
      visible: true,
    };
    await provider.resolveWebviewView(mockWebviewView as any, {} as any, {} as any);

    // Send ready message
    await messageHandler({ type: 'ready' });

    return { provider, sentPrompts, recordedPrompts, messages, touchedSessions, triggerMessage: (m: any) => messageHandler(m), sessionManager };
    }

  const editorContext: EditorContext = {
    filePath: examplePath,
    cursorLine: 7,
    cursorCharacter: 3,
    language: 'ts',
    selection: {
      startLine: 7,
      startCharacter: 1,
      endLine: 7,
      endCharacter: 10,
      text: 'const x = 1;',
    },
    currentLine: null,
    openEditors: [],
  };

  test('sends raw prompt when editor context link is disabled', async () => {
    const { provider, sentPrompts, recordedPrompts } = await createProvider(editorContext);

    await (provider as any).handleSendPrompt('raw prompt');

    assert.deepStrictEqual(sentPrompts, ['raw prompt']);
    assert.deepStrictEqual(recordedPrompts, ['raw prompt']);
  });

  test('sendPrompt message records source text and sends expanded agent text', async () => {
    const { triggerMessage, sentPrompts, recordedPrompts } = await createProvider(editorContext);

    await triggerMessage({
      type: 'sendPrompt',
      text: 'Check [@index.ts](file://src/a/index.ts)',
      agentText: 'Check @src/a/index.ts',
    });

    assert.deepStrictEqual(recordedPrompts, ['Check [@index.ts](file://src/a/index.ts)']);
    assert.deepStrictEqual(sentPrompts, ['Check @src/a/index.ts']);
  });

  test('sends enriched prompt to agent and records only raw prompt', async () => {
    const { provider, sentPrompts, recordedPrompts, messages } = await createProvider(editorContext);
    provider.setEditorContextLinked(true);

    await (provider as any).handleSendPrompt('raw prompt');

    assert.strictEqual(sentPrompts.length, 1);
    assert.ok(sentPrompts[0].includes('VS Code context:'));
    assert.ok(sentPrompts[0].includes('const x = 1;'));
    assert.ok(sentPrompts[0].endsWith('User prompt:\nraw prompt'));
    assert.deepStrictEqual(recordedPrompts, ['raw prompt']);
    assert.strictEqual(messages.some(message => message.type === 'info'), false);
  });

  test('falls back to raw prompt and posts info when linked context is unavailable', async () => {
    const { provider, sentPrompts, recordedPrompts, messages } = await createProvider(null);
    provider.setEditorContextLinked(true);

    await (provider as any).handleSendPrompt('raw prompt');

    assert.deepStrictEqual(sentPrompts, ['raw prompt']);
    assert.deepStrictEqual(recordedPrompts, ['raw prompt']);
    assert.ok(messages.some(message => message.type === 'info'));
    assert.ok(messages.some(message => message.type === 'promptStart'));
    assert.ok(messages.some(message => message.type === 'promptEnd'));
  });
  // ============ New tests ============

  test('handleSendPrompt with no activeSessionId posts error and does not call sendPrompt', async () => {
    const { provider, sentPrompts, messages } = await createProvider();
    // Override to have no active session
    (provider as any).sessionManager.getActiveSessionId = () => null;
    messages.length = 0;

    await (provider as any).handleSendPrompt('test prompt');

    assert.strictEqual(sentPrompts.length, 0);
    assert.ok(messages.some(m => m.type === 'error'));
    assert.ok(messages.some(m => m.type === 'error' && m.message.includes('No active session')));
  });

  test('handleSendPrompt error from sessionManager.sendPrompt posts error and promptEnd with stopReason error', async () => {
    const { provider, messages } = await createProvider();
    (provider as any).sessionManager.sendPrompt = async () => {
      throw new Error('Test error');
    };

    await (provider as any).handleSendPrompt('test prompt');

    const errorMessage = messages.find(m => m.type === 'error');
    assert.ok(errorMessage);
    assert.ok(errorMessage.message.includes('Test error'));

    const promptEnd = messages.find(m => m.type === 'promptEnd');
    assert.ok(promptEnd);
    assert.strictEqual(promptEnd.stopReason, 'error');
  });

  test('postMessage queues messages when isViewReady is false', async () => {
    const { provider, messages } = await createProvider();
    messages.length = 0;
    (provider as any).isViewReady = false;

    (provider as any).postMessage({ type: 'test1' });
    (provider as any).postMessage({ type: 'test2' });

    // Messages should be queued, not sent yet
    assert.strictEqual(messages.length, 0);
    assert.strictEqual((provider as any).pendingMessages.length, 2);

    // After setting ready and flushing
    (provider as any).isViewReady = true;
    (provider as any).flushPendingMessages();

    assert.strictEqual(messages.length, 2);
    assert.strictEqual(messages[0].type, 'test1');
    assert.strictEqual(messages[1].type, 'test2');
  });

  test('sendCurrentState posts session active with modes, models, configOptions, availableCommands, title', async () => {
    const { provider, messages } = await createProvider();
    (provider as any).isViewReady = true;

    const mockSession = {
      sessionId: 's1',
      agentDisplayName: 'Test Agent',
      title: 'Test Title',
      cwd: '/test',
      modes: { currentModeId: 'code' },
      models: { currentModelId: 'gpt-4' },
      configOptions: [{ id: 'mode1', category: 'mode', value: 'code' }],
      availableCommands: [{ id: 'cmd1', title: 'Command 1' }],
    };

    (provider as any).sessionManager.getActiveSessionId = () => 's1';
    (provider as any).sessionManager.getSession = () => mockSession;

    messages.length = 0;
    (provider as any).sendCurrentState();

    const stateMessage = messages.find(m => m.type === 'state');
    assert.ok(stateMessage);
    assert.strictEqual(stateMessage.activeSessionId, 's1');
    assert.strictEqual(stateMessage.session.sessionId, 's1');
    assert.strictEqual(stateMessage.session.agentName, 'Test Agent');
    assert.strictEqual(stateMessage.session.title, 'Test Title');
    assert.deepStrictEqual(stateMessage.session.modes, { currentModeId: 'code' });
    assert.deepStrictEqual(stateMessage.session.models, { currentModelId: 'gpt-4' });
    assert.deepStrictEqual(stateMessage.session.configOptions, [{ id: 'mode1', category: 'mode', value: 'code' }]);
    assert.deepStrictEqual(stateMessage.session.availableCommands, [{ id: 'cmd1', title: 'Command 1' }]);
  });

  test('handleSessionUpdate persists available_commands_update even for non-active session', async () => {
    const { provider, messages } = await createProvider();
    (provider as any).isViewReady = true;

    const activeSession = {
      sessionId: 's1',
      agentName: 'Agent A',
      availableCommands: [],
    };
    const inactiveSession = {
      sessionId: 's2',
      agentName: 'Agent B',
      availableCommands: [],
    };

    (provider as any).sessionManager.getActiveSessionId = () => 's1';
    (provider as any).sessionManager.sessions = new Map([
      ['s1', activeSession],
      ['s2', inactiveSession],
    ]);

    // Clear existing messages
    messages.length = 0;

    const update = {
      sessionId: 's2',
      update: {
        sessionUpdate: 'available_commands_update',
        availableCommands: [{ id: 'cmd1', title: 'Cmd1' }],
      },
    };

    (provider as any).handleSessionUpdate(update);

    // Should persist to session but not forward to webview
    assert.deepStrictEqual(activeSession.availableCommands, []);
    assert.deepStrictEqual(inactiveSession.availableCommands, [{ id: 'cmd1', title: 'Cmd1' }]);
    // No message forwarded since it's not the active session
    assert.strictEqual(messages.filter(m => m.type === 'sessionUpdate').length, 0);
  });

  test('handleApprovePipelinePlan on pipeline session posts promptStart, calls pipelineService.approvePlan, posts promptEnd', async () => {
    const pipelineService = {
      approvePlan: async (sessionId: string, plan: string) => {
        pipelineService.approvePlanCalled = { sessionId, plan };
        return 'implemented';
      },
      approvePlanCalled: null as { sessionId: string; plan: string } | null,
    };

    const provider = (await createProvider()).provider;
    (provider as any).pipelineService = pipelineService;
    (provider as any).sessionManager.getActiveSessionId = () => 'pipeline_s1';
    (provider as any).sessionManager.isPipelineSession = (sessionId: string) => sessionId === 'pipeline_s1';
    (provider as any).isViewReady = true;

    const messages: any[] = [];
    (provider as any).view = {
      webview: {
        postMessage: (message: any) => {
          messages.push(message);
          return Promise.resolve(true);
        },
      },
    };

    await (provider as any).handleApprovePipelinePlan('<proposed_plan>\nTest plan\n</proposed_plan>');

    assert.deepStrictEqual(pipelineService.approvePlanCalled, {
      sessionId: 'pipeline_s1',
      plan: '<proposed_plan>\nTest plan\n</proposed_plan>',
    });

    const promptStart = messages.find(m => m.type === 'promptStart');
    assert.ok(promptStart);

    const promptEnd = messages.find(m => m.type === 'promptEnd');
    assert.ok(promptEnd);
    assert.strictEqual(promptEnd.stopReason, 'end_turn');
  });

  test('handleRejectPipelinePlan calls pipelineService.rejectPlan', async () => {
    const pipelineService = {
      rejectPlan: (sessionId: string) => {
        pipelineService.rejectPlanCalled = sessionId;
      },
      rejectPlanCalled: null as string | null,
    };

    const provider = (await createProvider()).provider;
    (provider as any).pipelineService = pipelineService;
    (provider as any).sessionManager.getActiveSessionId = () => 'pipeline_s1';
    (provider as any).sessionManager.isPipelineSession = (sessionId: string) => sessionId === 'pipeline_s1';

    (provider as any).handleRejectPipelinePlan();

    assert.strictEqual(pipelineService.rejectPlanCalled, 'pipeline_s1');
  });

  test('handlePipelineStatus ignores events from other sessions', async () => {
    const { provider, messages } = await createProvider();
    (provider as any).isViewReady = true;
    (provider as any).sessionManager.getActiveSessionId = () => 'active_s1';

    messages.length = 0;

    const event = {
      sessionId: 'other_s1',
      status: 'planning',
      message: 'Planning...',
    };

    (provider as any).handlePipelineStatus(event);

    assert.strictEqual(messages.length, 0);
  });

  test('handlePipelineStatus forwards events from active session', async () => {
    const { provider, messages } = await createProvider();
    (provider as any).isViewReady = true;
    (provider as any).sessionManager.getActiveSessionId = () => 'active_s1';

    messages.length = 0;

    const event = {
      sessionId: 'active_s1',
      status: 'planning',
      message: 'Planning...',
    };

    (provider as any).handlePipelineStatus(event);

    const statusMessage = messages.find(m => m.type === 'pipelineStatus');
    assert.ok(statusMessage);
    assert.strictEqual(statusMessage.status, 'planning');
    assert.strictEqual(statusMessage.message, 'Planning...');
  });

  test('handlePipelinePlanReady ignores events from other sessions', async () => {
    const { provider, messages } = await createProvider();
    (provider as any).isViewReady = true;
    (provider as any).sessionManager.getActiveSessionId = () => 'active_s1';

    messages.length = 0;

    const event = {
      sessionId: 'other_s1',
      plan: '<proposed_plan>\nTest\n</proposed_plan>',
    };

    (provider as any).handlePipelinePlanReady(event);

    assert.strictEqual(messages.length, 0);
  });

  test('handlePipelinePlanReady forwards events from active session', async () => {
    const { provider, messages } = await createProvider();
    (provider as any).isViewReady = true;
    (provider as any).sessionManager.getActiveSessionId = () => 'active_s1';

    messages.length = 0;

    const event = {
      sessionId: 'active_s1',
      plan: '<proposed_plan>\nTest\n</proposed_plan>',
    };

    (provider as any).handlePipelinePlanReady(event);

    const planMessage = messages.find(m => m.type === 'pipelinePlanReady');
    assert.ok(planMessage);
    assert.strictEqual(planMessage.plan, '<proposed_plan>\nTest\n</proposed_plan>');
  });

  test('handlePipelineSessionUpdate ignores events from other sessions', async () => {
    const { provider, messages } = await createProvider();
    (provider as any).isViewReady = true;
    (provider as any).sessionManager.getActiveSessionId = () => 'active_s1';

    messages.length = 0;

    const event = {
      sessionId: 'other_s1',
      update: { update: { sessionUpdate: 'available_commands_update' } },
    };

    (provider as any).handlePipelineSessionUpdate(event);

    assert.strictEqual(messages.length, 0);
  });

  test('handlePipelineSessionUpdate forwards events from active session', async () => {
    const { provider, messages } = await createProvider();
    (provider as any).isViewReady = true;
    (provider as any).sessionManager.getActiveSessionId = () => 'active_s1';

    messages.length = 0;

    const updateData = { sessionUpdate: 'available_commands_update', availableCommands: [{ id: 'cmd1' }] };
    const event = {
      sessionId: 'active_s1',
      phase: 'planner',
      update: { update: updateData },
    };

    (provider as any).handlePipelineSessionUpdate(event);

    const updateMessage = messages.find(m => m.type === 'sessionUpdate');
    assert.ok(updateMessage);
    assert.deepStrictEqual(updateMessage.update, updateData);
    assert.strictEqual(updateMessage.phase, 'planner');
  });

  test('renderMarkdown removes script tags', async () => {
    const provider = (await createProvider()).provider;
    const html = (provider as any).renderMarkdown('<script>alert("xss");</script>Hello');

    assert.strictEqual(html.includes('<script>'), false);
    assert.strictEqual(html.includes('alert("xss")'), false);
    assert.ok(html.includes('Hello'));
  });

  test('renderMarkdown removes iframe tags', async () => {
    const provider = (await createProvider()).provider;
    const html = (provider as any).renderMarkdown('<iframe src="evil.com"></iframe>Hello');

    assert.strictEqual(html.includes('<iframe'), false);
    assert.strictEqual(html.includes('evil.com'), false);
    assert.ok(html.includes('Hello'));
  });

  test('renderMarkdown removes on* attributes', async () => {
    const provider = (await createProvider()).provider;
    const html = (provider as any).renderMarkdown('<div onclick="alert(1)" onmouseover="steal()">Click me</div>');

    assert.strictEqual(html.includes('onclick'), false);
    assert.strictEqual(html.includes('onmouseover'), false);
    assert.ok(html.includes('Click me'));
  });

  test('renderMarkdown removes javascript: URLs', async () => {
    const provider = (await createProvider()).provider;
    const html = (provider as any).renderMarkdown('<a href="javascript:alert(1)">Click</a>');

    assert.strictEqual(html.includes('javascript:'), false);
    assert.ok(html.includes('Click'));
  });

  test('executeCommand only executes commands in ALLOWED_WEBVIEW_COMMANDS', async () => {
    const { triggerMessage } = await createProvider();

    let commandExecuted = false;
    let commandName = '';

    // Mock vscode.commands.executeCommand
    const originalExecuteCommand = vscode.commands.executeCommand;
    (vscode.commands as any).executeCommand = async (command: string) => {
      commandExecuted = true;
      commandName = command;
      return undefined as any;
    };

    try {
      // Test allowed command
      await triggerMessage(
        { type: 'executeCommand', command: 'acp.connectAgent' }
      );
      assert.strictEqual(commandExecuted, true);
      assert.strictEqual(commandName, 'acp.connectAgent');

      // Reset
      commandExecuted = false;
      commandName = '';

      // Test disallowed command
      await triggerMessage(
        { type: 'executeCommand', command: 'some.evilCommand' }
      );
      assert.strictEqual(commandExecuted, false);
    } finally {
      vscode.commands.executeCommand = originalExecuteCommand;
    }
  });

  test('searchFiles returns empty list on error', async () => {
    const { provider, messages } = await createProvider();

    messages.length = 0;

    // Mock findFiles to throw error
    const originalFindFiles = vscode.workspace.findFiles;
    vscode.workspace.findFiles = async () => {
      throw new Error('Search failed');
    };

    try {
      await (provider as any).handleSearchFiles('test query', 1);

      const resultMessage = messages.find(m => m.type === 'fileSearchResults' && m.requestId === 1);
      assert.ok(resultMessage);
      assert.deepStrictEqual(resultMessage.results, []);
    } finally {
      vscode.workspace.findFiles = originalFindFiles;
    }
  });

  test('searchFiles disambiguates duplicate file names with relative suffixes', async () => {
    const { provider, messages } = await createProvider();
    messages.length = 0;

    const originalFindFiles = vscode.workspace.findFiles;
    const originalWorkspaceFolders = vscode.workspace.workspaceFolders;
    const originalGetWorkspaceFolder = vscode.workspace.getWorkspaceFolder;
    const workspaceFolder = {
      uri: vscode.Uri.file(workspaceRoot),
      name: 'workspace',
      index: 0,
    };

    Object.defineProperty(vscode.workspace, 'workspaceFolders', {
      value: [workspaceFolder],
      configurable: true,
    });
    vscode.workspace.findFiles = async () => [
      vscode.Uri.file(`${workspaceRoot}/src/a/index.ts`),
      vscode.Uri.file(`${workspaceRoot}/src/b/index.ts`),
    ];
    (vscode.workspace as any).getWorkspaceFolder = () => workspaceFolder;

    try {
      await (provider as any).handleSearchFiles('index', 7);

      const resultMessage = messages.find(m => m.type === 'fileSearchResults' && m.requestId === 7);
      assert.ok(resultMessage);
      assert.deepStrictEqual(
        resultMessage.results.map((result: any) => result.name),
        ['a/index.ts', 'b/index.ts'],
      );
      assert.deepStrictEqual(
        resultMessage.results.map((result: any) => result.path),
        ['src/a/index.ts', 'src/b/index.ts'],
      );
    } finally {
      vscode.workspace.findFiles = originalFindFiles;
      (vscode.workspace as any).getWorkspaceFolder = originalGetWorkspaceFolder;
      Object.defineProperty(vscode.workspace, 'workspaceFolders', {
        value: originalWorkspaceFolders,
        configurable: true,
      });
    }
  });

  test('searchFiles supports fuzzy indexed file matching', async () => {
    const { provider, messages } = await createProvider();
    messages.length = 0;

    const originalFindFiles = vscode.workspace.findFiles;
    const originalWorkspaceFolders = vscode.workspace.workspaceFolders;
    const originalGetWorkspaceFolder = vscode.workspace.getWorkspaceFolder;
    const workspaceFolder = {
      uri: vscode.Uri.file(workspaceRoot),
      name: 'workspace',
      index: 0,
    };

    Object.defineProperty(vscode.workspace, 'workspaceFolders', {
      value: [workspaceFolder],
      configurable: true,
    });
    vscode.workspace.findFiles = async () => [
      vscode.Uri.file(`${workspaceRoot}/src/services/UserService.ts`),
      vscode.Uri.file(`${workspaceRoot}/src/config/settings.ts`),
    ];
    (vscode.workspace as any).getWorkspaceFolder = () => workspaceFolder;

    try {
      await (provider as any).handleSearchFiles('userservce', 8);

      const resultMessage = messages.find(m => m.type === 'fileSearchResults' && m.requestId === 8);
      assert.ok(resultMessage);
      assert.deepStrictEqual(resultMessage.results[0], {
        path: 'src/services/UserService.ts',
        name: 'UserService.ts',
      });
    } finally {
      vscode.workspace.findFiles = originalFindFiles;
      (vscode.workspace as any).getWorkspaceFolder = originalGetWorkspaceFolder;
      Object.defineProperty(vscode.workspace, 'workspaceFolders', {
        value: originalWorkspaceFolders,
        configurable: true,
      });
    }
  });

  test('openFile ignores empty path', async () => {
    const provider = (await createProvider()).provider;

    const originalShowTextDocument = vscode.window.showTextDocument;
    let showTextDocumentCalled = false;
    vscode.window.showTextDocument = (async () => {
      showTextDocumentCalled = true;
      return undefined as any;
    }) as typeof vscode.window.showTextDocument;

    try {
      await (provider as any).handleOpenFile('');
      assert.strictEqual(showTextDocumentCalled, false);
    } finally {
      vscode.window.showTextDocument = originalShowTextDocument;
    }
  });

  test('openFile opens relative path via workspace folder', async () => {
    const { provider } = await createProvider();

    const workspaceFolder = {
      uri: vscode.Uri.file(workspaceRoot),
      name: 'workspace',
      index: 0,
    };

    // Mock workspace folders
    const originalWorkspaceFolders = vscode.workspace.workspaceFolders;
    Object.defineProperty(vscode.workspace, 'workspaceFolders', {
      value: [workspaceFolder],
      configurable: true,
    });

    const originalOpenTextDocument = vscode.workspace.openTextDocument;
    const originalShowTextDocument = vscode.window.showTextDocument;

    let openTextDocumentCalled = false;
    let showTextDocumentCalled = false;

    vscode.workspace.openTextDocument = (async (uri: vscode.Uri) => {
      openTextDocumentCalled = true;
      return { uri } as any;
    }) as unknown as typeof vscode.workspace.openTextDocument;

    vscode.window.showTextDocument = (async () => {
      showTextDocumentCalled = true;
      return undefined as any;
    }) as typeof vscode.window.showTextDocument;

    try {
      await (provider as any).handleOpenFile('src/test.ts');

      assert.strictEqual(openTextDocumentCalled, true);
      assert.strictEqual(showTextDocumentCalled, true);
    } finally {
      Object.defineProperty(vscode.workspace, 'workspaceFolders', {
        value: originalWorkspaceFolders,
        configurable: true,
      });
      vscode.workspace.openTextDocument = originalOpenTextDocument;
      vscode.window.showTextDocument = originalShowTextDocument;
    }
  });

  test('includes pending shared context in session state snapshot', async () => {
    const { provider, messages } = await createProvider(null);
    (provider as any).sessionManager.hasPendingSharedDiscussionContext = () => true;
    messages.length = 0;

    (provider as any).sendCurrentState();

    const stateMessage = messages.find(message => message.type === 'state');
    assert.strictEqual(stateMessage.session.pendingSharedContext, true);
  });
});
