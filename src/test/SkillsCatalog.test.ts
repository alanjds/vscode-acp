import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { clearSkillsCatalogCache, SkillsCatalog } from '../skills/SkillsCatalog';

suite('SkillsCatalog', () => {
  let root: string;

  setup(() => {
    clearSkillsCatalogCache();
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'skills-catalog-'));
  });

  teardown(() => {
    clearSkillsCatalogCache();
    fs.rmSync(root, { recursive: true, force: true });
  });

  function writeSkill(relativeDir: string, frontmatter: string, body = '# Skill'): void {
    const dir = path.join(root, '.agents', 'skills', relativeDir);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'SKILL.md'), `---\n${frontmatter}\n---\n\n${body}\n`, 'utf8');
  }

  test('lists model-invoked skills and skips user-invoked ones', () => {
    writeSkill('tdd', 'name: tdd\ndescription: Test-first development.');
    writeSkill('ask-matt', 'name: ask-matt\ndescription: Router skill.\ndisable-model-invocation: true');

    const catalog = new SkillsCatalog(root);
    const skills = catalog.listSkills();

    assert.strictEqual(skills.length, 2);
    assert.deepStrictEqual(
      skills.filter(skill => skill.modelInvoked).map(skill => skill.name),
      ['tdd'],
    );
    assert.strictEqual(skills.find(skill => skill.name === 'ask-matt')?.modelInvoked, false);
  });

  test('resolveSkill returns full content for /name and folder alias', () => {
    writeSkill('tdd', 'name: tdd\ndescription: TDD skill.', '# TDD body');

    const catalog = new SkillsCatalog(root);
    const byName = catalog.resolveSkill('tdd');
    const byFolder = catalog.resolveSkill('tdd');

    assert.ok(byName);
    assert.match(byName!.content, /# TDD body/);
    assert.strictEqual(byFolder?.entry.relativePath, '.agents/skills/tdd/SKILL.md');
  });

  test('buildCatalogText includes only model-invoked skills', () => {
    writeSkill('tdd', 'name: tdd\ndescription: Build test-first.');
    writeSkill('hidden', 'name: hidden\ndescription: Hidden.\ndisable-model-invocation: true');

    const text = new SkillsCatalog(root).buildCatalogText();

    assert.match(text, /tdd: Build test-first/);
    assert.doesNotMatch(text, /hidden:/);
  });
});
