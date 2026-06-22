import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { prepareCursorSkillsSymlink } from '../skills/SkillsWorkspacePrep';

suite('SkillsWorkspacePrep', () => {
  let root: string;

  setup(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'skills-workspace-prep-'));
  });

  teardown(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  test('creates .cursor/skills symlink to .agents/skills', () => {
    const skillsDir = path.join(root, '.agents', 'skills', 'tdd');
    fs.mkdirSync(skillsDir, { recursive: true });
    fs.writeFileSync(path.join(skillsDir, 'SKILL.md'), '# TDD\n', 'utf8');

    const result = prepareCursorSkillsSymlink(root);

    assert.strictEqual(result.createdSymlink, true);
    const linkPath = path.join(root, '.cursor', 'skills');
    assert.ok(fs.lstatSync(linkPath).isSymbolicLink());
    assert.strictEqual(
      fs.realpathSync(linkPath),
      fs.realpathSync(path.join(root, '.agents', 'skills')),
    );
  });

  test('does not overwrite an existing .cursor/skills directory', () => {
    const skillsDir = path.join(root, '.agents', 'skills');
    fs.mkdirSync(skillsDir, { recursive: true });
    const cursorSkills = path.join(root, '.cursor', 'skills');
    fs.mkdirSync(cursorSkills, { recursive: true });
    fs.writeFileSync(path.join(cursorSkills, 'existing.txt'), 'keep', 'utf8');

    const result = prepareCursorSkillsSymlink(root);

    assert.strictEqual(result.createdSymlink, false);
    assert.ok(result.warning);
    assert.strictEqual(fs.readFileSync(path.join(cursorSkills, 'existing.txt'), 'utf8'), 'keep');
  });
});
