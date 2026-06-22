import * as fs from 'node:fs';
import * as path from 'node:path';

import * as yaml from 'js-yaml';

import { getSkillsDirectory, getSkillsMaxCatalogBytes } from './SkillsConfig';

export interface SkillEntry {
  name: string;
  description: string;
  relativePath: string;
  absolutePath: string;
  modelInvoked: boolean;
}

interface SkillFrontmatter {
  name?: string;
  description?: string;
  'disable-model-invocation'?: boolean;
}

const catalogCache = new Map<string, { mtimeMs: number; skills: SkillEntry[] }>();

function parseFrontmatter(content: string): { frontmatter: SkillFrontmatter; body: string } {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) {
    return { frontmatter: {}, body: content };
  }

  const frontmatter = yaml.load(match[1]) as SkillFrontmatter;
  return { frontmatter: frontmatter || {}, body: match[2] };
}

function folderNameFromPath(skillFilePath: string): string {
  return path.basename(path.dirname(skillFilePath));
}

function resolveSkillName(frontmatter: SkillFrontmatter, skillFilePath: string): string {
  if (typeof frontmatter.name === 'string' && frontmatter.name.trim()) {
    return frontmatter.name.trim();
  }
  return folderNameFromPath(skillFilePath);
}

function walkSkillFiles(rootDir: string): string[] {
  if (!fs.existsSync(rootDir)) {
    return [];
  }

  const files: string[] = [];
  const stack = [rootDir];

  while (stack.length > 0) {
    const current = stack.pop()!;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const entryPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(entryPath);
        continue;
      }
      if (entry.isFile() && entry.name === 'SKILL.md') {
        files.push(entryPath);
      }
    }
  }

  return files.sort();
}

function getSkillsRootMtime(workspaceCwd: string, skillsDirectory: string): number {
  const root = path.resolve(workspaceCwd, skillsDirectory);
  if (!fs.existsSync(root)) {
    return 0;
  }

  try {
    return fs.statSync(root).mtimeMs;
  } catch {
    return 0;
  }
}

export class SkillsCatalog {
  constructor(
    private readonly workspaceCwd: string,
    private readonly skillsDirectory: string = getSkillsDirectory(),
    private readonly maxCatalogBytes: number = getSkillsMaxCatalogBytes(),
  ) {}

  listSkills(): SkillEntry[] {
    const root = path.resolve(this.workspaceCwd, this.skillsDirectory);
    const cacheKey = `${this.workspaceCwd}:${this.skillsDirectory}`;
    const mtimeMs = getSkillsRootMtime(this.workspaceCwd, this.skillsDirectory);
    const cached = catalogCache.get(cacheKey);
    if (cached && cached.mtimeMs === mtimeMs) {
      return cached.skills.map(skill => ({ ...skill }));
    }

    const skills = walkSkillFiles(root).map(filePath => {
      const content = fs.readFileSync(filePath, 'utf8');
      const { frontmatter } = parseFrontmatter(content);
      const disableModelInvocation = frontmatter['disable-model-invocation'] === true;
      return {
        name: resolveSkillName(frontmatter, filePath),
        description: typeof frontmatter.description === 'string' ? frontmatter.description.trim() : '',
        relativePath: path.relative(this.workspaceCwd, filePath).replace(/\\/g, '/'),
        absolutePath: filePath,
        modelInvoked: !disableModelInvocation,
      };
    });

    catalogCache.set(cacheKey, { mtimeMs, skills });
    return skills.map(skill => ({ ...skill }));
  }

  resolveSkill(name: string): { entry: SkillEntry; content: string } | null {
    const normalized = name.replace(/^\//, '').trim().toLowerCase();
    if (!normalized) {
      return null;
    }

    for (const entry of this.listSkills()) {
      const folderName = path.basename(path.dirname(entry.absolutePath)).toLowerCase();
      if (entry.name.toLowerCase() === normalized || folderName === normalized) {
        const content = fs.readFileSync(entry.absolutePath, 'utf8');
        return { entry, content };
      }
    }

    return null;
  }

  buildCatalogText(): string {
    const modelInvoked = this.listSkills().filter(skill => skill.modelInvoked);
    if (modelInvoked.length === 0) {
      return '';
    }

    const lines = modelInvoked.map(skill => {
      const description = skill.description || '(no description)';
      return `- ${skill.name}: ${description} (path: ${skill.relativePath})`;
    });

    let catalog = lines.join('\n');
    const header = [
      'When a skill is relevant, read its SKILL.md via the filesystem before acting.',
      'When the user types /skill-name, follow that skill fully.',
      '',
    ].join('\n');

    while (Buffer.byteLength(`${header}${catalog}`, 'utf8') > this.maxCatalogBytes && lines.length > 1) {
      lines.pop();
      catalog = `${lines.join('\n')}\n…(catalog truncated)`;
    }

    if (Buffer.byteLength(`${header}${catalog}`, 'utf8') > this.maxCatalogBytes) {
      return '';
    }

    return `${header}${catalog}`;
  }
}

export function clearSkillsCatalogCache(): void {
  catalogCache.clear();
}
