import * as assert from 'assert';
import { JSDOM } from 'jsdom';

import {
  getMarkdownEditableCursorPosition,
  getMarkdownEditableText,
  renderMarkdownEditableContent,
  setMarkdownEditableCursorPosition,
  type MarkdownFileMention,
} from '../../webview/src/testing';

const mentionToken = '[@f](file://a)';
const fileMentions: MarkdownFileMention[] = [{ token: mentionToken, path: 'a', name: 'f' }];

let dom: JSDOM | undefined;

function createEditor(value: string, mentions: MarkdownFileMention[] = fileMentions): HTMLDivElement {
  const editor = document.createElement('div');
  document.body.appendChild(editor);
  renderMarkdownEditableContent(editor, value, mentions);
  return editor;
}

function assertCursorRoundTrip(editor: HTMLDivElement, value: string, cursorPosition: number): void {
  setMarkdownEditableCursorPosition(editor, cursorPosition);
  assert.strictEqual(getMarkdownEditableCursorPosition(editor), cursorPosition);
  assert.strictEqual(getMarkdownEditableText(editor), value);
}

suite('MarkdownEditableDom', () => {
  setup(() => {
    dom = new JSDOM('<!doctype html><html><body></body></html>');
    (globalThis as any).window = dom.window;
    (globalThis as any).document = dom.window.document;
    (globalThis as any).Node = dom.window.Node;
    (globalThis as any).HTMLElement = dom.window.HTMLElement;
    (globalThis as any).HTMLDivElement = dom.window.HTMLDivElement;
    (globalThis as any).Range = dom.window.Range;
  });

  teardown(() => {
    document.body.replaceChildren();
    window.getSelection()?.removeAllRanges();
    dom?.window.close();
    dom = undefined;
    delete (globalThis as any).window;
    delete (globalThis as any).document;
    delete (globalThis as any).Node;
    delete (globalThis as any).HTMLElement;
    delete (globalThis as any).HTMLDivElement;
    delete (globalThis as any).Range;
  });

  test('case A: cursor after newline following a mention', () => {
    const value = `${mentionToken}\n`;
    const editor = createEditor(value);
    assertCursorRoundTrip(editor, value, value.length);
  });

  test('case B: cursor at start of text on line after mention', () => {
    const value = `${mentionToken}\nhello`;
    const editor = createEditor(value);
    assertCursorRoundTrip(editor, value, mentionToken.length + 1);
  });

  test('case C: cursor at start of second line after mention and inline text', () => {
    const value = `${mentionToken} hello\nworld`;
    const editor = createEditor(value);
    const cursorPosition = value.indexOf('world');
    assertCursorRoundTrip(editor, value, cursorPosition);
  });

  test('case D: cursor positions in plain multiline text without mentions', () => {
    const value = 'line1\nline2';
    const editor = createEditor(value, []);
    assertCursorRoundTrip(editor, value, value.indexOf('line2') + 2);
    assertCursorRoundTrip(editor, value, value.length);
  });

  test('case E: render uses br elements instead of literal newline text nodes', () => {
    const value = `${mentionToken}\nhello`;
    const editor = createEditor(value);
    const brCount = editor.querySelectorAll('br').length;
    assert.strictEqual(brCount, 1);
    for (const node of Array.from(editor.childNodes)) {
      if (node.nodeType === Node.TEXT_NODE) {
        assert.ok(!(node.textContent ?? '').includes('\n'));
      }
    }
  });

  test('case E: text round-trip after render and cursor placement', () => {
    const value = `${mentionToken} hello\nworld\n`;
    const editor = createEditor(value);
    setMarkdownEditableCursorPosition(editor, value.length);
    assert.strictEqual(getMarkdownEditableText(editor), value);
    assert.strictEqual(getMarkdownEditableCursorPosition(editor), value.length);
  });
});
