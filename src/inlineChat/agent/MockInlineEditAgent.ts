import { InlineEditRequest, InlineEditResult } from '../InlineChatTypes';
import { InlineEditAgent } from './InlineEditAgent';

/**
 * Mock agent for testing inline chat UX
 */
export class MockInlineEditAgent implements InlineEditAgent {
  async generateEdit(request: InlineEditRequest): Promise<InlineEditResult> {
    const { selection, selectedText } = request;

    if (selectedText.trim()) {
      // If there's selected text, wrap it with a comment
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

    // If no selection, insert at cursor position
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

  getDisplayName(): string {
    return 'Mock Agent';
  }
}
