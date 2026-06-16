import * as assert from 'assert';

import type { PipelinePrimitiveDefinition } from '../../config/PipelineCatalog';
import { shouldRunInSandbox, runSandboxedAcpAgent } from '../../sandbox/sandboxedAgentRun';
import type { SandboxContext } from '../../sandbox/SandboxContext';

const WORKSPACE_PRIMITIVE: PipelinePrimitiveDefinition = {
  agent: 'Vibe',
  output: 'markdown',
  sideEffects: 'workspace',
  prompt: 'edit',
};

const READONLY_PRIMITIVE: PipelinePrimitiveDefinition = {
  agent: 'Codex',
  output: 'markdown',
  sideEffects: 'none',
  prompt: 'read',
};

suite('sandboxedAgentRun', () => {
  test('shouldRunInSandbox is true only for workspace primitives when enabled', () => {
    assert.strictEqual(shouldRunInSandbox(WORKSPACE_PRIMITIVE, true), true);
    assert.strictEqual(shouldRunInSandbox(WORKSPACE_PRIMITIVE, false), false);
    assert.strictEqual(shouldRunInSandbox(READONLY_PRIMITIVE, true), false);
  });

  test('runSandboxedAcpAgent creates sandbox and shows promotion for workspace primitive', async () => {
    const created: SandboxContext[] = [];
    const promoted: SandboxContext[] = [];
    const sandbox: SandboxContext = {
      id: 'run-1',
      root: '/repo/.acp/sandboxes/run-1',
      baseCwd: '/repo',
      baseRef: 'abc',
      branch: 'sandbox/run-1',
      createdAt: new Date().toISOString(),
    };

    const result = await runSandboxedAcpAgent({
      primitive: WORKSPACE_PRIMITIVE,
      workspaceCwd: '/repo',
      agentName: 'Vibe',
      promptText: 'do work',
      isSandboxEnabled: () => true,
      sandboxService: {
        create: async () => {
          created.push(sandbox);
          return sandbox;
        },
        destroy: async () => undefined,
      } as any,
      sandboxPromotionPanel: {
        show: async (ctx: SandboxContext) => {
          promoted.push(ctx);
          return 'applied';
        },
      } as any,
      runRunner: async (cwd, sandboxContext) => {
        assert.strictEqual(cwd, sandbox.root);
        assert.strictEqual(sandboxContext?.id, sandbox.id);
        return 'ok';
      },
    });

    assert.strictEqual(result, 'ok');
    assert.strictEqual(created.length, 1);
    assert.strictEqual(promoted.length, 1);
  });
});
