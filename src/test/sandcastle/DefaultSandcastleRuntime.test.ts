import * as assert from 'assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { prepareCodexHome } from '../../sandcastle/DefaultSandcastleRuntime';

suite('DefaultSandcastleRuntime', () => {
  let repo: string;

  setup(() => {
    repo = fs.mkdtempSync(path.join(os.tmpdir(), 'sandcastle-codex-home-'));
  });

  teardown(() => {
    fs.rmSync(repo, { recursive: true, force: true });
  });

  test('prepareCodexHome creates a writable sandbox-local directory', () => {
    const codexHome = prepareCodexHome(repo);
    assert.strictEqual(codexHome, path.join(repo, '.sandcastle', 'codex-home'));
    assert.ok(fs.existsSync(codexHome));
    fs.writeFileSync(path.join(codexHome, 'runtime.txt'), 'ok', 'utf8');
    assert.strictEqual(fs.readFileSync(path.join(codexHome, 'runtime.txt'), 'utf8'), 'ok');
  });
});
