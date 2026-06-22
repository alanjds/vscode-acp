import { findAllMarkdownFileMentions } from '../app/composer';

export type MarkdownFileMention = {
  token: string;
  path: string;
  name: string;
};

type RenderedMention = MarkdownFileMention & {
  start: number;
  end: number;
};

function isMentionElement(node: Node): node is HTMLElement {
  return node instanceof HTMLElement && node.classList.contains('prompt-file-mention');
}

function getNodeToken(node: Node): string | null {
  return isMentionElement(node) ? node.dataset.token ?? null : null;
}

function serializeNode(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) {
    return node.textContent ?? '';
  }

  if (node.nodeName === 'BR') {
    return '\n';
  }

  const token = getNodeToken(node);
  if (token !== null) {
    return token;
  }

  return Array.from(node.childNodes).map(serializeNode).join('');
}

export function getMarkdownEditableText(input: HTMLElement): string {
  return Array.from(input.childNodes).map(serializeNode).join('');
}

function getRenderedMentions(value: string, fileMentions: MarkdownFileMention[] | undefined): RenderedMention[] {
  const byToken = new Map((fileMentions ?? []).map(mention => [mention.token, mention]));
  const matches = findAllMarkdownFileMentions(value)
    .map((match) => {
      const selectedMention = byToken.get(match.fullMatch);
      return {
        token: match.fullMatch,
        path: selectedMention?.path ?? match.filePath,
        name: selectedMention?.name ?? match.displayName,
        start: match.start,
        end: match.end,
      };
    })
    .sort((a, b) => a.start - b.start || b.end - a.end);

  const nonOverlapping: RenderedMention[] = [];
  let consumedUntil = -1;
  for (const match of matches) {
    if (match.start < consumedUntil) {
      continue;
    }
    nonOverlapping.push(match);
    consumedUntil = match.end;
  }

  return nonOverlapping;
}

function createMentionElement(mention: RenderedMention): HTMLSpanElement {
  const chip = document.createElement('span');
  chip.className = 'prompt-file-mention';
  chip.contentEditable = 'false';
  chip.dataset.token = mention.token;
  chip.dataset.filePath = mention.path;
  chip.dataset.fileName = mention.name;
  chip.title = `Click to open ${mention.path}`;
  chip.textContent = mention.name;
  return chip;
}

function appendTextWithLineBreaks(nodes: Node[], text: string): void {
  if (!text) {
    return;
  }

  const parts = text.split('\n');
  for (let index = 0; index < parts.length; index += 1) {
    if (parts[index]) {
      nodes.push(document.createTextNode(parts[index]));
    }
    if (index < parts.length - 1) {
      nodes.push(document.createElement('br'));
    }
  }
}

export function renderMarkdownEditableContent(
  input: HTMLElement,
  value: string,
  fileMentions: MarkdownFileMention[] | undefined,
): void {
  if (!value) {
    input.replaceChildren();
    return;
  }

  const renderedMentions = getRenderedMentions(value, fileMentions);
  if (renderedMentions.length === 0) {
    const nodes: Node[] = [];
    appendTextWithLineBreaks(nodes, value);
    input.replaceChildren(...nodes);
    return;
  }

  const nodes: Node[] = [];
  let cursor = 0;

  for (const mention of renderedMentions) {
    if (mention.start > cursor) {
      appendTextWithLineBreaks(nodes, value.slice(cursor, mention.start));
    }

    nodes.push(createMentionElement(mention));
    cursor = mention.end;
  }

  if (cursor < value.length) {
    appendTextWithLineBreaks(nodes, value.slice(cursor));
  }

  input.replaceChildren(...nodes);
}

function hasLiteralNewlinesInTextNodes(input: HTMLElement): boolean {
  const walker = document.createTreeWalker(input, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();
  while (node) {
    if ((node.textContent ?? '').includes('\n')) {
      return true;
    }
    node = walker.nextNode();
  }
  return false;
}

export function needsMarkdownEditableResync(input: HTMLElement, value: string): boolean {
  if (value === '') {
    return input.childNodes.length > 0;
  }

  const domText = getMarkdownEditableText(input);
  if (domText !== value) {
    return true;
  }

  return value.includes('\n') && hasLiteralNewlinesInTextNodes(input);
}

function getSerializedLengthBeforePosition(node: Node, target: Node, offset: number): { length: number; found: boolean } {
  if (node === target) {
    if (node.nodeType === Node.TEXT_NODE) {
      return { length: (node.textContent ?? '').slice(0, offset).length, found: true };
    }

    if (node.nodeName === 'BR') {
      return { length: offset > 0 ? 1 : 0, found: true };
    }

    let length = 0;
    for (let index = 0; index < Math.min(offset, node.childNodes.length); index += 1) {
      length += serializeNode(node.childNodes[index]).length;
    }
    return { length, found: true };
  }

  const token = getNodeToken(node);
  if (token !== null) {
    return { length: token.length, found: false };
  }

  let length = 0;
  for (const child of Array.from(node.childNodes)) {
    const result = getSerializedLengthBeforePosition(child, target, offset);
    if (result.found) {
      return { length: length + result.length, found: true };
    }
    length += serializeNode(child).length;
  }

  return { length, found: false };
}

export function getMarkdownEditableCursorPosition(input: HTMLElement): number {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) {
    return getMarkdownEditableText(input).length;
  }

  const range = selection.getRangeAt(0);
  if (!input.contains(range.endContainer)) {
    return getMarkdownEditableText(input).length;
  }

  return getSerializedLengthBeforePosition(input, range.endContainer, range.endOffset).length;
}

function setRangeAtTextNode(node: Node, offset: number): void {
  const range = document.createRange();
  const selection = window.getSelection();
  range.setStart(node, offset);
  range.collapse(true);
  selection?.removeAllRanges();
  selection?.addRange(range);
}

function setRangeBeforeElement(element: HTMLElement): void {
  const range = document.createRange();
  const selection = window.getSelection();
  range.setStartBefore(element);
  range.collapse(true);
  selection?.removeAllRanges();
  selection?.addRange(range);
}

function setRangeAfterElement(element: HTMLElement): void {
  const range = document.createRange();
  const selection = window.getSelection();
  range.setStartAfter(element);
  range.collapse(true);
  selection?.removeAllRanges();
  selection?.addRange(range);
}

function setRangeAroundElement(element: HTMLElement, after: boolean): void {
  if (after) {
    setRangeAfterElement(element);
  } else {
    setRangeBeforeElement(element);
  }
}

function placeCursorWithinNode(node: Node, remaining: number): boolean {
  if (node.nodeType === Node.TEXT_NODE) {
    const textLength = node.textContent?.length ?? 0;
    if (remaining <= textLength) {
      setRangeAtTextNode(node, remaining);
      return true;
    }
    return false;
  }

  if (node.nodeName === 'BR') {
    if (remaining === 0) {
      setRangeBeforeElement(node as HTMLElement);
      return true;
    }
    if (remaining === 1) {
      setRangeAfterElement(node as HTMLElement);
      return true;
    }
    return false;
  }

  const token = getNodeToken(node);
  if (token !== null) {
    if (remaining <= token.length) {
      setRangeAroundElement(node as HTMLElement, remaining > 0);
      return true;
    }
    return false;
  }

  let cursor = remaining;
  for (const child of Array.from(node.childNodes)) {
    const childText = serializeNode(child);
    if (cursor <= childText.length) {
      return placeCursorWithinNode(child, cursor);
    }
    cursor -= childText.length;
  }

  return false;
}

export function setMarkdownEditableCursorPosition(input: HTMLElement, cursorPosition: number): void {
  const targetPosition = Math.max(0, Math.min(cursorPosition, getMarkdownEditableText(input).length));
  if (placeCursorWithinNode(input, targetPosition)) {
    return;
  }

  const range = document.createRange();
  const selection = window.getSelection();
  range.selectNodeContents(input);
  range.collapse(false);
  selection?.removeAllRanges();
  selection?.addRange(range);
}
