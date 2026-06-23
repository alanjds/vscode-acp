import * as assert from 'assert';
import * as vscode from 'vscode';

import { RunAbortedError } from '../core/RunAbortedError';
import { MockInlineEditAgent } from '../inlineChat/agent/MockInlineEditAgent';
import type { InlineEditAgent } from '../inlineChat/agent/InlineEditAgent';
import type { InlineEditRequest, InlineEditResult } from '../inlineChat/InlineChatTypes';
import {
  InlineEditSession,
  type InlineEditSessionHost,
} from '../inlineChat/InlineEditSession';
import type { InlineChatResponse } from '../inlineChat/InlineChatTypes';

class SlowInlineEditAgent extends MockInlineEditAgent {
  readonly generateEditCalls: InlineEditRequest[] = [];

  constructor(private readonly delayMs: number) {
    super();
  }

  override async generateEdit(
    request: InlineEditRequest,
    options?: { signal?: AbortSignal },
  ): Promise<InlineEditResult> {
    this.generateEditCalls.push(request);

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

class ErrorInlineEditAgent implements InlineEditAgent {
  async generateEdit(): Promise<InlineEditResult> {
    throw new Error('generation failed');
  }

  getDisplayName(): string {
    return 'Error Agent';
  }
}

interface RecordedHostCall {
  method: 'post' | 'close' | 'showWarning' | 'showError';
  args: unknown[];
}

function createMockHost(): InlineEditSessionHost & { calls: RecordedHostCall[] } {
  const calls: RecordedHostCall[] = [];

  return {
    calls,
    async post(message: InlineChatResponse): Promise<void> {
      calls.push({ method: 'post', args: [message] });
    },
    close(): void {
      calls.push({ method: 'close', args: [] });
    },
    showWarning(message: string): void {
      calls.push({ method: 'showWarning', args: [message] });
    },
    showError(message: string): void {
      calls.push({ method: 'showError', args: [message] });
    },
  };
}

function createMockEditor(options: {
  version: number;
  applyResult?: boolean;
  applyError?: Error;
}): vscode.TextEditor & { document: vscode.TextDocument & { version: number } } {
  const lines = ['const x = 1;', 'const y = 2;'];
  const selection = new vscode.Selection(0, 0, 0, 0);

  const document = {
    version: options.version,
    uri: vscode.Uri.parse('file:///tmp/example.ts'),
    languageId: 'typescript',
    fileName: 'example.ts',
    lineCount: lines.length,
    lineAt(line: number): vscode.TextLine {
      const text = lines[line] ?? '';
      return {
        text,
        range: new vscode.Range(line, 0, line, text.length),
      } as vscode.TextLine;
    },
    getText(range?: vscode.Range | vscode.Selection): string {
      if (!range) {
        return lines.join('\n');
      }

      if (range instanceof vscode.Selection) {
        if (range.isEmpty) {
          return '';
        }
        return lines.slice(range.start.line, range.end.line + 1).join('\n');
      }

      return lines.slice(range.start.line, range.end.line + 1).join('\n');
    },
  } as vscode.TextDocument & { version: number };

  return {
    document,
    selection,
    edit: async () => {
      if (options.applyError) {
        throw options.applyError;
      }
      return options.applyResult ?? true;
    },
  } as unknown as vscode.TextEditor & { document: vscode.TextDocument & { version: number } };
}

function postMessages(host: ReturnType<typeof createMockHost>): InlineChatResponse[] {
  return host.calls
    .filter(call => call.method === 'post')
    .map(call => call.args[0] as InlineChatResponse);
}

suite('InlineEditSession', () => {
  test('submit success posts thinking then proposal', async () => {
    const host = createMockHost();
    const session = new InlineEditSession(
      createMockEditor({ version: 1 }),
      new MockInlineEditAgent(),
      host,
    );

    await session.handleMessage({ type: 'submit', prompt: 'add comment' });

    const messages = postMessages(host);
    assert.strictEqual(messages.length, 2);
    assert.deepStrictEqual(messages[0], {
      type: 'status',
      value: 'thinking',
      agent: 'Mock Agent',
    });
    assert.strictEqual(messages[1]?.type, 'proposal');
    if (messages[1]?.type === 'proposal') {
      assert.ok(messages[1].summary.length > 0);
      assert.ok(messages[1].editsCount > 0);
    }
  });

  test('submit error posts error status and shows error message', async () => {
    const host = createMockHost();
    const session = new InlineEditSession(
      createMockEditor({ version: 1 }),
      new ErrorInlineEditAgent(),
      host,
    );

    await session.handleMessage({ type: 'submit', prompt: 'fail please' });

    const messages = postMessages(host);
    assert.deepStrictEqual(messages[0], {
      type: 'status',
      value: 'thinking',
      agent: 'Error Agent',
    });
    assert.deepStrictEqual(messages[1], { type: 'status', value: 'error' });
    assert.ok(host.calls.some(call =>
      call.method === 'showError'
      && typeof call.args[0] === 'string'
      && call.args[0].includes('generation failed'),
    ));
  });

  test('submit aborted does not post proposal or error', async () => {
    const host = createMockHost();
    const session = new InlineEditSession(
      createMockEditor({ version: 1 }),
      new SlowInlineEditAgent(500),
      host,
    );

    const submitPromise = session.handleMessage({ type: 'submit', prompt: 'slow edit' });
    await new Promise(resolve => setTimeout(resolve, 25));
    await session.handleMessage({ type: 'stop' });
    await submitPromise;

    const messages = postMessages(host);
    assert.ok(messages.some(message => message.type === 'status' && message.value === 'thinking'));
    assert.ok(messages.some(message => message.type === 'status' && message.value === 'ready'));
    assert.strictEqual(messages.some(message => message.type === 'proposal'), false);
    assert.strictEqual(messages.some(message => message.type === 'status' && message.value === 'error'), false);
    assert.strictEqual(host.calls.some(call => call.method === 'showError'), false);
  });

  test('accept applied closes host when document version matches', async () => {
    const host = createMockHost();
    const session = new InlineEditSession(
      createMockEditor({ version: 3 }),
      new MockInlineEditAgent(),
      host,
    );

    await session.handleMessage({ type: 'submit', prompt: 'add comment' });
    await session.handleMessage({ type: 'accept' });

    assert.ok(host.calls.some(call => call.method === 'close'));
    assert.strictEqual(host.calls.some(call => call.method === 'showWarning'), false);
  });

  test('accept stale warns when document changed after proposal', async () => {
    const host = createMockHost();
    const editor = createMockEditor({ version: 2 });
    const session = new InlineEditSession(editor, new MockInlineEditAgent(), host);

    await session.handleMessage({ type: 'submit', prompt: 'add comment' });
    editor.document.version = 3;
    await session.handleMessage({ type: 'accept' });

    assert.ok(host.calls.some(call =>
      call.method === 'showWarning'
      && typeof call.args[0] === 'string'
      && call.args[0].includes('document changed'),
    ));
    assert.strictEqual(host.calls.some(call => call.method === 'close'), false);
  });

  test('reject closes host and aborts active run', async () => {
    const host = createMockHost();
    const agent = new SlowInlineEditAgent(500);
    const session = new InlineEditSession(
      createMockEditor({ version: 1 }),
      agent,
      host,
    );

    const submitPromise = session.handleMessage({ type: 'submit', prompt: 'slow edit' });
    await new Promise(resolve => setTimeout(resolve, 25));
    await session.handleMessage({ type: 'reject' });
    await submitPromise;

    assert.ok(host.calls.some(call => call.method === 'close'));
    assert.strictEqual(postMessages(host).some(message => message.type === 'proposal'), false);
  });

  test('cancel closes host and aborts active run', async () => {
    const host = createMockHost();
    const session = new InlineEditSession(
      createMockEditor({ version: 1 }),
      new SlowInlineEditAgent(500),
      host,
    );

    const submitPromise = session.handleMessage({ type: 'submit', prompt: 'slow edit' });
    await new Promise(resolve => setTimeout(resolve, 25));
    await session.handleMessage({ type: 'cancel' });
    await submitPromise;

    assert.ok(host.calls.some(call => call.method === 'close'));
    assert.strictEqual(postMessages(host).some(message => message.type === 'proposal'), false);
  });

  test('stop aborts active run and posts ready status', async () => {
    const host = createMockHost();
    const session = new InlineEditSession(
      createMockEditor({ version: 1 }),
      new SlowInlineEditAgent(500),
      host,
    );

    const submitPromise = session.handleMessage({ type: 'submit', prompt: 'slow edit' });
    await new Promise(resolve => setTimeout(resolve, 25));
    await session.handleMessage({ type: 'stop' });
    await submitPromise;

    assert.ok(postMessages(host).some(message =>
      message.type === 'status' && message.value === 'ready',
    ));
    assert.strictEqual(postMessages(host).some(message => message.type === 'proposal'), false);
  });

  test('concurrent submit aborts first run and only second produces proposal', async () => {
    const host = createMockHost();
    const agent = new SlowInlineEditAgent(200);
    const session = new InlineEditSession(
      createMockEditor({ version: 1 }),
      agent,
      host,
    );

    const firstSubmit = session.handleMessage({ type: 'submit', prompt: 'first' });
    await new Promise(resolve => setTimeout(resolve, 25));
    const secondSubmit = session.handleMessage({ type: 'submit', prompt: 'second' });

    await firstSubmit;
    await secondSubmit;

    assert.strictEqual(agent.generateEditCalls.length, 2);
    assert.strictEqual(agent.generateEditCalls[1]?.prompt, 'second');

    const proposals = postMessages(host).filter(message => message.type === 'proposal');
    assert.strictEqual(proposals.length, 1);
  });
});
