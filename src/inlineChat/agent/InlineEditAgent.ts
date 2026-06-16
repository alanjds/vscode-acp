import * as vscode from 'vscode';
import { InlineEditRequest, InlineEditResult } from '../InlineChatTypes';

/**
 * Agent interface for generating inline edits
 */
export interface InlineEditAgent {
  generateEdit(request: InlineEditRequest): Promise<InlineEditResult>;
  /**
   * Optional display name for UI while generating edits.
   */
  getDisplayName?(): string | Promise<string>;
}
