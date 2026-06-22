import {
  AgentSideConnection,
  ndJsonStream,
} from '@agentclientprotocol/sdk';
import { Readable, Writable } from 'node:stream';

import { parseBridgeConfig } from './BridgeConfig';
import { SandcastleAcpAgent } from './SandcastleAcpAgent';
import { defaultSandcastleRuntime } from './DefaultSandcastleRuntime';

/**
 * Écrit une erreur fatale sur stderr sans polluer stdout (réservé au NDJSON ACP).
 *
 * @param error - Erreur ou valeur à diagnostiquer en fin de vie du processus bridge.
 * @returns void ; effet de bord : écriture préfixée `[sandcastle-acp-bridge]` sur stderr.
 */
function reportFatal(error: unknown): void {
  const message = error instanceof Error ? error.stack || error.message : String(error);
  process.stderr.write(`[sandcastle-acp-bridge] ${message}\n`);
}

// ACP reserves stdout for NDJSON. Sandcastle's file logging mode still prints a
// short startup hint with console.log, so route console diagnostics to stderr.
console.log = (...values: unknown[]) => {
  process.stderr.write(`${values.map(String).join(' ')}\n`);
};
console.info = console.log;

try {
  const config = parseBridgeConfig(process.argv.slice(2), process.env);
  const writable = Writable.toWeb(process.stdout) as WritableStream<Uint8Array>;
  const readable = Readable.toWeb(process.stdin) as ReadableStream<Uint8Array>;
  const stream = ndJsonStream(writable, readable);
  let agent: SandcastleAcpAgent | undefined;
  const connection = new AgentSideConnection(conn => {
    agent = new SandcastleAcpAgent(conn, config, defaultSandcastleRuntime);
    return agent;
  }, stream);

  connection.closed
    .then(() => agent?.dispose())
    .catch(reportFatal);
} catch (error) {
  reportFatal(error);
  process.exitCode = 1;
}
