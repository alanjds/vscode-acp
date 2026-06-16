import type { SessionNotification } from '@agentclientprotocol/sdk';

import type { PipelinePrimitiveDefinition } from '../config/PipelineCatalog';
import { AcpAgentRunner } from '../pipeline/AcpAgentRunner';
import { isSandboxEnabled } from './SandboxConfig';
import type { SandboxContext } from './SandboxContext';
import type { SandboxPromotionPanel } from './SandboxPromotionPanel';
import type { SandboxService } from './SandboxService';

export interface SandboxedAgentRunOptions {
  primitive: PipelinePrimitiveDefinition;
  workspaceCwd: string;
  agentName: string;
  promptText: string;
  signal?: AbortSignal;
  onSessionUpdate?: (update: SessionNotification) => void;
  sandboxService?: SandboxService;
  sandboxPromotionPanel?: SandboxPromotionPanel;
  isSandboxEnabled?: () => boolean;
  runRunner?: (cwd: string, sandbox?: SandboxContext) => Promise<string>;
}

export function shouldRunInSandbox(
  primitive: PipelinePrimitiveDefinition,
  enabled: boolean,
): boolean {
  return enabled && primitive.sideEffects === 'workspace';
}

export async function runSandboxedAcpAgent(options: SandboxedAgentRunOptions): Promise<string> {
  const enabled = options.isSandboxEnabled?.() ?? isSandboxEnabled();
  let sandbox: SandboxContext | undefined;

  if (shouldRunInSandbox(options.primitive, enabled)) {
    if (!options.sandboxService || !options.sandboxPromotionPanel) {
      throw new Error('Sandbox is enabled but sandbox services are not configured.');
    }
    sandbox = await options.sandboxService.create(options.workspaceCwd);
  }

  const runRunner = options.runRunner ?? ((cwd, sandboxContext) => {
    const runner = new AcpAgentRunner(() => cwd);
    return runner.run(options.agentName, options.promptText, {
      onSessionUpdate: options.onSessionUpdate,
      signal: options.signal,
      sandbox: sandboxContext,
    });
  });

  try {
    const cwd = sandbox?.root ?? options.workspaceCwd;
    const result = await runRunner(cwd, sandbox);
    if (sandbox && options.sandboxPromotionPanel) {
      await options.sandboxPromotionPanel.show(sandbox);
    }
    return result;
  } catch (error) {
    if (sandbox && options.sandboxService) {
      await options.sandboxService.destroy(sandbox);
    }
    throw error;
  }
}
