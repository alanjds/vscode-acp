import * as fs from 'node:fs';
import * as path from 'node:path';

import { log } from '../utils/Logger';

export interface SkillsWorkspacePrepResult {
  createdSymlink: boolean;
  warning?: string;
}

/**
 * Ensures Cursor CLI can discover project skills via `.cursor/skills`.
 */
export function prepareCursorSkillsSymlink(
  workspaceCwd: string,
  skillsDirectory = '.agents/skills',
): SkillsWorkspacePrepResult {
  const agentsSkillsDir = path.resolve(workspaceCwd, skillsDirectory);
  if (!fs.existsSync(agentsSkillsDir)) {
    return { createdSymlink: false };
  }

  const cursorDir = path.resolve(workspaceCwd, '.cursor');
  const cursorSkillsLink = path.join(cursorDir, 'skills');
  const relativeTarget = path.relative(cursorDir, agentsSkillsDir);

  if (fs.existsSync(cursorSkillsLink)) {
    try {
      const stat = fs.lstatSync(cursorSkillsLink);
      if (stat.isSymbolicLink()) {
        const linkTarget = fs.readlinkSync(cursorSkillsLink);
        const resolved = path.resolve(cursorDir, linkTarget);
        if (resolved === agentsSkillsDir) {
          return { createdSymlink: false };
        }
      }
    } catch {
      // Fall through to warning below.
    }

    const warning = '`.cursor/skills` already exists and does not point at `.agents/skills`; leaving it unchanged.';
    log(warning);
    return { createdSymlink: false, warning };
  }

  fs.mkdirSync(cursorDir, { recursive: true });
  fs.symlinkSync(relativeTarget, cursorSkillsLink, 'dir');
  log(`Created symlink ${cursorSkillsLink} -> ${relativeTarget}`);
  return { createdSymlink: true };
}
