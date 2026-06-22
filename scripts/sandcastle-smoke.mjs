import {
  ClientSideConnection,
  PROTOCOL_VERSION,
  ndJsonStream,
} from '@agentclientprotocol/sdk';
import { spawn } from 'node:child_process';
import { existsSync, unlinkSync } from 'node:fs';
import { Readable, Writable } from 'node:stream';
import path from 'node:path';

const provider = process.argv[2];
const action = process.argv[3];
if (!['codex', 'cursor'].includes(provider) || !['apply', 'reject'].includes(action)) {
  throw new Error('Usage: node scripts/sandcastle-smoke.mjs codex|cursor apply|reject');
}

const root = process.cwd();
const model = provider === 'codex' ? 'gpt-5.4' : 'composer-2';
const sentinelRelative = `.sandcastle-smoke-${provider}.txt`;
const sentinelPath = path.join(root, sentinelRelative);
if (existsSync(sentinelPath)) {
  unlinkSync(sentinelPath);
}

const bridge = spawn(process.execPath, [
  path.join(root, 'dist', 'sandcastle-acp-bridge.js'),
  '--provider', provider,
  '--model', model,
], {
  cwd: root,
  env: process.env,
  stdio: ['pipe', 'pipe', 'pipe'],
});
bridge.stderr.pipe(process.stderr);

const updates = [];
const client = {
  async sessionUpdate(notification) {
    updates.push(notification);
    const text = notification.update?.content?.text;
    if (text) {
      process.stderr.write(text);
    }
  },
};

const stream = ndJsonStream(
  Writable.toWeb(bridge.stdin),
  Readable.toWeb(bridge.stdout),
);
const connection = new ClientSideConnection(() => client, stream);
let sessionId;

try {
  await connection.initialize({
    protocolVersion: PROTOCOL_VERSION,
    clientInfo: { name: 'sandcastle-smoke', version: '0.1.0' },
    clientCapabilities: {},
  });
  const session = await connection.newSession({ cwd: root, mcpServers: [] });
  sessionId = session.sessionId;
  await connection.prompt({
    sessionId,
    prompt: [{
      type: 'text',
      text: `Create exactly one file named ${sentinelRelative} containing the text "${provider} smoke ok". Do not modify any other file.`,
    }],
  });

  if (existsSync(sentinelPath)) {
    throw new Error('The sentinel reached the main workspace before promotion.');
  }
  const preview = await connection.extMethod('sandcastle/preview', { sessionId });
  if (Number(preview.filesChanged) < 1) {
    throw new Error('Sandcastle reported no changed files.');
  }

  const result = await connection.extMethod(`sandcastle/${action}`, { sessionId });
  if (result.success !== true) {
    throw new Error(String(result.message || `${action} failed`));
  }
  if (action === 'apply' && !existsSync(sentinelPath)) {
    throw new Error('Apply did not transfer the sentinel to the main workspace.');
  }
  if (action === 'reject' && existsSync(sentinelPath)) {
    throw new Error('Reject transferred the sentinel unexpectedly.');
  }
  process.stderr.write(`\n${provider} ${action} smoke test passed (${updates.length} ACP update(s)).\n`);
} finally {
  if (sessionId) {
    await connection.closeSession({ sessionId }).catch(() => undefined);
  }
  bridge.kill('SIGTERM');
  if (existsSync(sentinelPath)) {
    unlinkSync(sentinelPath);
  }
}
