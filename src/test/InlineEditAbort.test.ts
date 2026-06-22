import * as assert from 'assert';

import { RunAbortedError, isRunAbortedError } from '../core/RunAbortedError';
import { MockInlineEditAgent } from '../inlineChat/agent/MockInlineEditAgent';
import type { InlineEditRequest } from '../inlineChat/InlineChatTypes';

class SlowInlineEditAgent extends MockInlineEditAgent {
  constructor(private readonly delayMs: number) {
    super();
  }

  override async generateEdit(
    request: InlineEditRequest,
    options?: { signal?: AbortSignal },
  ) {
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(resolve, this.delayMs);
      options?.signal?.addEventListener('abort', () => {
        clearTimeout(timeout);
        reject(new RunAbortedError());
      }, { once: true });
    });

    return super.generateEdit(request, options);
  }
}

suite('Inline edit abort', () => {
  const request: InlineEditRequest = {
    prompt: 'edit this',
    uri: 'file:///tmp/example.ts',
    languageId: 'typescript',
    fileName: 'example.ts',
    selection: {
      active: { line: 0, character: 0 },
      anchor: { line: 0, character: 0 },
      start: { line: 0, character: 0 },
      end: { line: 0, character: 0 },
      isEmpty: true,
      isSingleLine: true,
      isReversed: false,
    } as any,
    selectedText: '',
    contextText: 'const x = 1;',
  };

  test('mock agent rejects when signal is aborted before completion', async () => {
    const agent = new SlowInlineEditAgent(500);
    const controller = new AbortController();
    const promise = agent.generateEdit(request, { signal: controller.signal });

    controller.abort();

    await assert.rejects(
      () => promise,
      (error: unknown) => isRunAbortedError(error),
    );
  });
});
