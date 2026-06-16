import { InlineChatMessage, InlineChatResponse } from '../InlineChatTypes';

/**
 * Message types for communication between extension and webview
 */
export type WebviewMessage = InlineChatMessage | InlineChatResponse;

/**
 * Protocol for webview communication
 */
export class InlineChatProtocol {
  static readonly TYPE_SUBMIT = 'submit';
  static readonly TYPE_ACCEPT = 'accept';
  static readonly TYPE_REJECT = 'reject';
  static readonly TYPE_STOP = 'stop';
  static readonly TYPE_CANCEL = 'cancel';
  static readonly TYPE_STATUS = 'status';
  static readonly TYPE_PROPOSAL = 'proposal';

  /**
   * Create a submit message
   */
  static submit(prompt: string): InlineChatMessage {
    return { type: this.TYPE_SUBMIT, prompt };
  }

  /**
   * Create an accept message
   */
  static accept(): InlineChatMessage {
    return { type: this.TYPE_ACCEPT };
  }

  /**
   * Create a reject message
   */
  static reject(): InlineChatMessage {
    return { type: this.TYPE_REJECT };
  }

  /**
   * Create a stop message
   */
  static stop(): InlineChatMessage {
    return { type: this.TYPE_STOP };
  }

  /**
   * Create a cancel message
   */
  static cancel(): InlineChatMessage {
    return { type: this.TYPE_CANCEL };
  }

  /**
   * Create a status response
   */
  static status(value: 'thinking' | 'ready' | 'error'): InlineChatResponse {
    return { type: this.TYPE_STATUS, value };
  }

  /**
   * Create a proposal response
   */
  static proposal(summary: string, editsCount: number): InlineChatResponse {
    return { type: this.TYPE_PROPOSAL, summary, editsCount };
  }

  /**
   * Check if a message is a user action
   */
  static isUserAction(message: WebviewMessage): message is InlineChatMessage {
    return [
      this.TYPE_SUBMIT,
      this.TYPE_ACCEPT,
      this.TYPE_REJECT,
      this.TYPE_STOP,
      this.TYPE_CANCEL
    ].includes(message.type);
  }

  /**
   * Check if a message is a response from extension
   */
  static isResponse(message: WebviewMessage): message is InlineChatResponse {
    return [
      this.TYPE_STATUS,
      this.TYPE_PROPOSAL
    ].includes(message.type);
  }
}
