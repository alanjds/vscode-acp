import { InlineEditRequest, InlineEditResult } from '../InlineChatTypes';

/**
 * Agent interface for generating inline edits
 */
export interface InlineEditOptions {
  signal?: AbortSignal;
}

export interface InlineEditAgent {
  generateEdit(request: InlineEditRequest, options?: InlineEditOptions): Promise<InlineEditResult>;
  /**
   * Optional display name for UI while generating edits.
   */
  getDisplayName?(): string | Promise<string>;
}
