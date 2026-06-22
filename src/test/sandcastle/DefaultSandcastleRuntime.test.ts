import * as assert from 'assert';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { prepareCodexHome, buildSandboxMounts } from '../../sandcastle/SandboxMounts';

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

  test('buildSandboxMounts includes .agents and codex auth mounts', () => {
    const agentsDir = path.join(repo, '.agents', 'skills');
    fs.mkdirSync(agentsDir, { recursive: true });

    const mounts = buildSandboxMounts({ provider: 'codex', model: 'gpt-5.4', imageName: 'img' }, repo);

    assert.ok(mounts.some(mount => mount.sandboxPath === '.agents'));
    assert.ok(mounts.some(mount => mount.sandboxPath === '/home/agent/.codex'));
  });
});
