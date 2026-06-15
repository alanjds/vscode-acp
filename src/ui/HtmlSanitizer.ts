import { marked } from 'marked';

/**
 * Utility for sanitizing HTML content before rendering in webviews.
 * Extracted from ChatWebviewProvider to separate concerns and improve reusability.
 */
export class HtmlSanitizer {
  /**
   * Render markdown to sanitized HTML.
   */
  static renderMarkdown(text: string): string {
    try {
      const html = marked.parse(text) as string;
      return this.sanitizeHtml(html);
    } catch {
      return this.escapeHtml(text);
    }
  }

  /**
   * Sanitize HTML by removing potentially dangerous content.
   * Removes scripts, iframes, event handlers, and other XSS vectors.
   */
  static sanitizeHtml(html: string): string {
    return html
      // Remove script tags and content
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
      // Remove iframe tags
      .replace(/<iframe\b[^>]*>/gi, '')
      // Remove on* attributes (event handlers)
      .replace(/\s+on\w+\s*=\s*["'][^"']*["']/gi, '')
      // Remove javascript: URLs
      .replace(/href\s*=\s*["']javascript:[^"']*["']/gi, '')
      // Remove any remaining dangerous content
      .replace(/<[^>]+\s+style\s*=\s*["'][^"']*expression\([^"']*["']/gi, '');
  }

  /**
   * Escape HTML special characters to prevent XSS.
   */
  static escapeHtml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
}
