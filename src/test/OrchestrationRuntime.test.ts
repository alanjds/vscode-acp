import * as assert from 'assert';
import { EventEmitter } from 'node:events';

import { OrchestrationRuntime } from '../plugins/orchestration/OrchestrationRuntime';

suite('OrchestrationRuntime', () => {
  test('owns virtual conversations, chat projections and disposal', async () => {
    const pipelines = new EventEmitter() as any;
    const calls: string[] = [];
    pipelines.createPlan = async (sessionId: string, text: string, agentName: string) => {
      calls.push(`plan:${sessionId}:${text}:${agentName}`);
    };
    pipelines.cancel = (sessionId: string) => calls.push(`cancel:${sessionId}`);
    pipelines.approvePlan = async (sessionId: string, plan: string) => calls.push(`approve:${sessionId}:${plan}`);
    pipelines.rejectPlan = (sessionId: string) => calls.push(`reject:${sessionId}`);
    pipelines.dispose = async () => calls.push('dispose:pipelines');

    let registeredRuntime: any;
    let runtimeRegistrationDisposed = false;
    const sessions = {
      registerVirtualSessionRuntime: (runtime: any) => {
        registeredRuntime = runtime;
        return { dispose: () => { runtimeRegistrationDisposed = true; } };
      },
      getActiveSessionId: () => 'virtual-1',
      isVirtualSession: (sessionId: string) => sessionId === 'virtual-1',
      ingestSessionUpdate: () => undefined,
      isLoading: () => false,
      touchHistory: (sessionId: string) => calls.push(`touch:${sessionId}`),
    } as any;

    const handlers = new Map<string, (message: any) => unknown>();
    const messages: any[] = [];
    const chat = {
      registerFeatureMessageHandler: (type: string, handler: (message: any) => unknown) => {
        handlers.set(type, handler);
        return { dispose: () => handlers.delete(type) };
      },
      postMessage: (message: any) => messages.push(message),
    } as any;

    const runtime = new OrchestrationRuntime(pipelines, sessions, chat);
    runtime.activate();

    assert.strictEqual(registeredRuntime, runtime);
    const response = await runtime.sendPrompt('virtual-1', 'build it', 'Team');
    assert.strictEqual(response.stopReason, 'end_turn');
    pipelines.emit('status', { sessionId: 'virtual-1', status: 'planning', message: 'Planning' });
    await handlers.get('approvePipelinePlan')?.({ plan: '<proposed_plan>x</proposed_plan>' });
    handlers.get('rejectPipelinePlan')?.({});

    assert.ok(messages.some(message => message.type === 'pipelineStatus'));
    assert.ok(calls.includes('plan:virtual-1:build it:Team'));
    assert.ok(calls.includes('approve:virtual-1:<proposed_plan>x</proposed_plan>'));
    assert.ok(calls.includes('reject:virtual-1'));

    runtime.dispose();
    runtime.dispose();
    assert.strictEqual(runtimeRegistrationDisposed, true);
    assert.strictEqual(handlers.size, 0);
    assert.strictEqual(calls.filter(call => call === 'dispose:pipelines').length, 1);
  });
});
