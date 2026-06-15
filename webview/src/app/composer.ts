import type { SlashCommand } from '../chatTypes';
import type { SelectedFileMention } from '../chatTypes';

// Regex to match Markdown file mentions: [@filename](file://path)
const MARKDOWN_FILE_MENTION_REGEX = /\[@([^\]]+)\]\(file:\/\/([^)]+)\)/g;

export type ParsedUserMessage = {
  badgeText: string;
  body?: string;
};

export type ActiveFileMention = {
  start: number;
  end: number;
  query: string;
};

export type FileMentionMatch = {
  fullMatch: string;
  displayName: string;
  filePath: string;
  start: number;
  end: number;
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
  
  // Check if cursor is inside a Markdown file mention
  const markdownMentions = findAllMarkdownFileMentions(text);
  for (const mention of markdownMentions) {
    if (cursor >= mention.start && cursor <= mention.end) {
      // Cursor is inside a markdown mention, don't trigger new mention
      return null;
    }
  }
  
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

export function findAllMarkdownFileMentions(text: string): FileMentionMatch[] {
  const mentions: FileMentionMatch[] = [];
  let match;
  
  while ((match = MARKDOWN_FILE_MENTION_REGEX.exec(text)) !== null) {
    mentions.push({
      fullMatch: match[0],
      displayName: match[1],
      filePath: match[2],
      start: match.index,
      end: match.index + match[0].length,
    });
  }
  
  return mentions;
}

export function replaceActiveFileMention(
  text: string,
  mention: ActiveFileMention,
  displayText: string,
  filePath?: string,
): { text: string; cursorPosition: number } {
  const suffix = text[mention.end] && !/\s/.test(text[mention.end]) ? '' : ' ';
  
  // Create Markdown link format for file mentions
  const filePathForLink = filePath || displayText;
  const replacement = `[@${displayText}](file://${filePathForLink})${suffix}`;
  
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
  // First, expand old-style @filename mentions
  let result = selectedMentions.reduce((nextText, mention) => {
    // Handle both old token format and new markdown format
    if (mention.token.startsWith('[@') && mention.token.includes('](file://')) {
      // Already in markdown format, extract the path
      const pathMatch = mention.token.match(/\[@([^\]]+)\]\(file:\/\/([^)]+)\)/);
      if (pathMatch) {
        return nextText.split(mention.token).join(`@${pathMatch[2]}`);
      }
    }
    // Old format: @filename
    return nextText.split(mention.token).join(`@${mention.path}`);
  }, text);
  
  // Also handle any markdown mentions that weren't in selectedMentions
  result = result.replace(MARKDOWN_FILE_MENTION_REGEX, (fullMatch, displayName, filePath) => {
    return `@${filePath}`;
  });
  
  return result;
}

/**
 * Extract file path from a markdown file mention token
 */
export function extractFilePathFromToken(token: string): string | null {
  const match = token.match(/\[@([^\]]+)\]\(file:\/\/([^)]+)\)/);
  return match ? match[2] : null;
}

/**
 * Extract display name from a markdown file mention token
 */
export function extractDisplayNameFromToken(token: string): string | null {
  const match = token.match(/\[@([^\]]+)\]\(file:\/\/([^)]+)\)/);
  return match ? match[1] : null;
}

/**
 * Check if text contains any markdown file mentions
 */
export function hasMarkdownFileMentions(text: string): boolean {
  return MARKDOWN_FILE_MENTION_REGEX.test(text);
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
