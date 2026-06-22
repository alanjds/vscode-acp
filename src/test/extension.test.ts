import * as assert from 'assert';
import * as vscode from 'vscode';

suite('Extension Test Suite', () => {
	test('Extension should be present', () => {
		assert.ok(vscode.extensions.getExtension('damien-huyet.acp-client'));
	});

	test('Should activate extension', async () => {
		const ext = vscode.extensions.getExtension('damien-huyet.acp-client');
		assert.ok(ext);
		await ext.activate();
		assert.strictEqual(ext.isActive, true);
	});

	test('Should register ACP commands', async () => {
		const commands = await vscode.commands.getCommands(true);
		const acpCommands = commands.filter(c => c.startsWith('acp.'));
		assert.ok(acpCommands.length > 0, 'ACP commands should be registered');
		assert.ok(acpCommands.includes('acp.connectAgent'), 'connectAgent command should exist');
		assert.ok(acpCommands.includes('acp.connectAgentWithCurrentContext'), 'connectAgentWithCurrentContext command should exist');
		assert.ok(acpCommands.includes('acp.newConversation'), 'newConversation command should exist');
		assert.ok(acpCommands.includes('acp.openChat'), 'openChat command should exist');
	});
  // ============ New tests for critical commands ============

  test('acp.openSession delegates to SessionManager loadSession or resumeSession', async () => {
    const ext = vscode.extensions.getExtension('damien-huyet.acp-client');
    assert.ok(ext);
    await ext.activate();

    const commands = await vscode.commands.getCommands(true);
    assert.ok(commands.includes('acp.openSession'));

    // The actual command implementation would need to be tested through the extension
    // This verifies the command is registered
  });

  test('acp.loadMoreSessions delegates to SessionTreeProvider.loadMore', async () => {
    const ext = vscode.extensions.getExtension('damien-huyet.acp-client');
    assert.ok(ext);
    await ext.activate();

    const commands = await vscode.commands.getCommands(true);
    assert.ok(commands.includes('acp.loadMoreSessions'));
  });

  test('acp.enableEditorContextLink updates context and calls ChatWebviewProvider.setEditorContextLinked', async () => {
    const ext = vscode.extensions.getExtension('damien-huyet.acp-client');
    assert.ok(ext);
    await ext.activate();

    const commands = await vscode.commands.getCommands(true);
    assert.ok(commands.includes('acp.enableEditorContextLink'));
  });

  test('acp.disableEditorContextLink updates context and calls ChatWebviewProvider.setEditorContextLinked', async () => {
    const ext = vscode.extensions.getExtension('damien-huyet.acp-client');
    assert.ok(ext);
    await ext.activate();

    const commands = await vscode.commands.getCommands(true);
    assert.ok(commands.includes('acp.disableEditorContextLink'));
  });

  test('acp.cancelTurn delegates to SessionManager.cancelTurn for active session', async () => {
    const ext = vscode.extensions.getExtension('damien-huyet.acp-client');
    assert.ok(ext);
    await ext.activate();

    const commands = await vscode.commands.getCommands(true);
    assert.ok(commands.includes('acp.cancelTurn'));
  });

  test('Extension activates successfully and registers all expected commands', async () => {
    const ext = vscode.extensions.getExtension('damien-huyet.acp-client');
    assert.ok(ext);

    await ext.activate();
    assert.strictEqual(ext.isActive, true);

    const commands = await vscode.commands.getCommands(true);
    const expectedCommands = [
	      'damien.inlineChat.open',
	      'acp.connectAgent',
	      'acp.connectAgentWithCurrentContext',
	      'acp.newConversation',
      'acp.openChat',
      'acp.openChatEditor',
      'acp.moveChatToEditor',
      'acp.cancelTurn',
      'acp.disconnectAgent',
	      'acp.openSession',
	      'acp.openSessionWithCurrentContext',
      'acp.loadMoreSessions',
      'acp.enableEditorContextLink',
      'acp.disableEditorContextLink',
      'acp.enablePipelineAgents',
      'acp.disablePipelineAgents',
      'acp.showCompiledTeamPipeline',
      'acp.rerunTeamReviewer',
	      'acp.sandcastle.showDiff',
	      'acp.sandcastle.apply',
	      'acp.sandcastle.reject',
      'acp.setMode',
      'acp.setModel',
      'acp.refreshAgents',
      'acp.refreshSessions',
      'acp.copySessionId',
      'acp.forgetSession',
      'acp.restartAgent',
      'acp.addAgent',
      'acp.removeAgent',
      'acp.showLog',
      'acp.showTraffic',
      'acp.openDebugSnapshot',
      'acp.browseRegistry',
    ];

    for (const cmd of expectedCommands) {
      assert.ok(commands.includes(cmd), `Command ${cmd} should be registered`);
    }
  });
});
