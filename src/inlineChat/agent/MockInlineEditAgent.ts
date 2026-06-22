import { RunAbortedError } from '../../core/RunAbortedError';
import { InlineEditRequest, InlineEditResult } from '../InlineChatTypes';
import { InlineEditAgent, InlineEditOptions } from './InlineEditAgent';

/**
 * Mock agent for testing inline chat UX
 */
export class MockInlineEditAgent implements InlineEditAgent {
  async generateEdit(request: InlineEditRequest, options?: InlineEditOptions): Promise<InlineEditResult> {
    await this.waitUnlessAborted(options?.signal);

    const { selection, selectedText } = request;

    if (selectedText.trim()) {
      return {
        summary: 'Mock proposal: wrap selection with comment',
        edits: [
          {
            range: {
              start: {
                line: selection.start.line,
                character: selection.start.character
              },
              end: {
                line: selection.end.line,
                character: selection.end.character
              }
            },
            newText: `// Damien edited this block\n${selectedText}`
          }
        ]
      };
    }

    return {
      summary: 'Mock insertion: add comment at cursor',
      edits: [
        {
          range: {
            start: {
              line: selection.active.line,
              character: selection.active.character
            },
            end: {
              line: selection.active.line,
              character: selection.active.character
            }
          },
          newText: `// Damien generated code here\n`
        }
      ]
    };
  }

  private waitUnlessAborted(signal?: AbortSignal): Promise<void> {
    if (!signal) {
      return Promise.resolve();
    }

    if (signal.aborted) {
      return Promise.reject(new RunAbortedError());
    }

    return new Promise((resolve, reject) => {
      const onAbort = (): void => {
        signal.removeEventListener('abort', onAbort);
        reject(new RunAbortedError());
      };
      signal.addEventListener('abort', onAbort, { once: true });
      queueMicrotask(() => {
        signal.removeEventListener('abort', onAbort);
        resolve();
      });
    });
  }

  getDisplayName(): string {
    return 'Mock Agent';
  }
}
