import type { SlashCommand } from '../chatTypes';
import type { SelectedFileMention } from '../chatTypes';

export type ParsedUserMessage = {
  badgeText: string;
  body?: string;
};

export type ActiveFileMention = {
  start: number;
  end: number;
  query: string;
};

export function parseUserMessage(text: string): ParsedUserMessage | null {
  const newlineIndex = text.indexOf('\n');
  const firstLine = newlineIndex >= 0 ? text.slice(0, newlineIndex) : text;
  const parenOpen = firstLine.indexOf(' (');
  if (parenOpen <= 0) {
    return null;
  }

  const fileName = firstLine.slice(0, parenOpen);
  const cursorMatch = firstLine.match(/\[cursor (\d+:\d+)\]/);
  const cursorPos = cursorMatch?.[1];
  const rest = newlineIndex >= 0 ? text.slice(newlineIndex + 1).trimStart() : '';
  return {
    badgeText: cursorPos ? `${fileName} · ${cursorPos}` : fileName,
    body: rest || undefined,
  };
}

export function getActiveFileMention(text: string, cursorPosition: number): ActiveFileMention | null {
  const cursor = Math.max(0, Math.min(cursorPosition, text.length));
  const prefix = text.slice(0, cursor);
  const tokenStart = Math.max(
    prefix.lastIndexOf(' '),
    prefix.lastIndexOf('\n'),
    prefix.lastIndexOf('\t'),
  ) + 1;

  if (text[tokenStart] !== '@') {
    return null;
  }

  if (tokenStart > 0 && /\S/.test(text[tokenStart - 1])) {
    return null;
  }

  let end = cursor;
  while (end < text.length && !/\s/.test(text[end])) {
    end += 1;
  }

  const query = text.slice(tokenStart + 1, cursor);
  if (query.includes('@')) {
    return null;
  }

  return {
    start: tokenStart,
    end,
    query,
  };
}

export function replaceActiveFileMention(
  text: string,
  mention: ActiveFileMention,
  displayText: string,
): { text: string; cursorPosition: number } {
  const suffix = text[mention.end] && !/\s/.test(text[mention.end]) ? '' : ' ';
  const replacement = `@${displayText}${suffix}`;
  const nextText = `${text.slice(0, mention.start)}${replacement}${text.slice(mention.end)}`;
  return {
    text: nextText,
    cursorPosition: mention.start + replacement.length,
  };
}

export function expandFileMentionsForPrompt(
  text: string,
  selectedMentions: readonly SelectedFileMention[],
): string {
  return selectedMentions.reduce((nextText, mention) => {
    return nextText.split(mention.token).join(`@${mention.path}`);
  }, text);
}

export function getBasePlaceholder(commands: SlashCommand[]): string {
  return commands.length > 0
    ? 'Type a message, @ for files, or / for commands...'
    : 'Type a message or @ for files...';
}

export function getSlashFilteredCommands(promptText: string, commands: SlashCommand[]): SlashCommand[] {
  if (!promptText.startsWith('/')) {
    return [];
  }

  const firstSpace = promptText.indexOf(' ');
  if (firstSpace >= 0) {
    return [];
  }

  const query = promptText.slice(1).toLowerCase();
  return commands.filter((command) => command.name.toLowerCase().startsWith(query));
}
