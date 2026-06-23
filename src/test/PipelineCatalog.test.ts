import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';

import { parsePipelineYaml } from '../config/PipelineCatalog';
import { repoRoot } from './repoRoot';

const VALID_PIPELINE = `
version: 2
id: feature-dev
title: Feature Development

primitives:
  plan:
    agent: Codex
    output: proposed_plan
    sideEffects: none
    prompt: |
      Plan this:
      {{userPrompt}}
  repo_search:
    agent: Codex
    output: markdown
    sideEffects: none
    prompt: |
      Research:
      {{steps.plan.output}}
  test_search:
    agent: Codex
    output: markdown
    sideEffects: none
    prompt: |
      Find tests:
      {{steps.plan.output}}
  synthesize:
    agent: Codex
    output: proposed_plan
    sideEffects: none
    prompt: |
      Synthesize:
      {{steps.investigate.branches.repo.output}}
      {{steps.investigate.branches.tests.output}}
  edit:
    agent: Vibe
    output: markdown
    sideEffects: workspace
    prompt: |
      Implement:
      {{steps.approve.output}}

steps:
  - id: plan
    use: plan
  - id: investigate
    type: parallel
    branches:
      - id: repo
        use: repo_search
      - id: tests
        use: test_search
  - id: synthesize
    use: synthesize
  - id: approve
    type: approval
    input: "{{steps.synthesize.output}}"
  - id: edit
    use: edit
`;

suite('PipelineCatalog', () => {
  test('parses a valid v2 primitive-first YAML pipeline', () => {
    const result = parsePipelineYaml(
      VALID_PIPELINE,
      '/repo/.acp/pipelines/feature-dev.yaml',
      { Codex: {}, Vibe: {} },
    );

    assert.deepStrictEqual(result.errors, []);
    assert.ok(result.definition);
    assert.strictEqual(result.definition.version, 2);
    assert.strictEqual(result.definition.title, 'Feature Development');
    assert.strictEqual(result.definition.primitives.edit.sideEffects, 'workspace');
    assert.strictEqual(result.definition.steps.length, 5);
  });

  test('parses the repository example pipeline', () => {
    const text = fs.readFileSync(
      path.join(repoRoot(), '.acp', 'pipelines', 'plan-execute-verify.yaml'),
      'utf8',
    );
    const result = parsePipelineYaml(
      text,
      '/repo/.acp/pipelines/plan-execute-verify.yaml',
      { 'Cursor CLI': {}, Vibe: {}, 'Codex CLI': {}, 'Claude Code': {} },
    );

    assert.deepStrictEqual(result.errors, []);
    assert.strictEqual(result.definition?.id, 'plan-execute-verify');
  });

  test('rejects v1 pipelines', () => {
    const result = parsePipelineYaml(
      VALID_PIPELINE.replace('version: 2', 'version: 1'),
      '/repo/.acp/pipelines/feature-dev.yaml',
      { Codex: {}, Vibe: {} },
    );

    assert.ok(result.errors.some(error => error.includes('version must be 2')));
    assert.strictEqual(result.definition, undefined);
  });

  test('rejects primitives that reference missing agents', () => {
    const result = parsePipelineYaml(
      VALID_PIPELINE,
      '/repo/.acp/pipelines/feature-dev.yaml',
      { Codex: {} },
    );

    assert.ok(result.errors.some(error => error.includes('Vibe')));
    assert.strictEqual(result.definition, undefined);
  });

  test('rejects duplicate step ids', () => {
    const result = parsePipelineYaml(
      VALID_PIPELINE.replace('id: investigate', 'id: plan'),
      '/repo/.acp/pipelines/feature-dev.yaml',
      { Codex: {}, Vibe: {} },
    );

    assert.ok(result.errors.some(error => error.includes('duplicated')));
  });

  test('rejects template references to future steps', () => {
    const result = parsePipelineYaml(
      VALID_PIPELINE.replace('{{userPrompt}}', '{{steps.synthesize.output}}'),
      '/repo/.acp/pipelines/feature-dev.yaml',
      { Codex: {}, Vibe: {} },
    );

    assert.ok(result.errors.some(error => error.includes('previous step')));
  });

  test('rejects workspace side effects before approval', () => {
    const result = parsePipelineYaml(
      VALID_PIPELINE.replace('repo_search:\n    agent: Codex\n    output: markdown\n    sideEffects: none', 'repo_search:\n    agent: Codex\n    output: markdown\n    sideEffects: workspace'),
      '/repo/.acp/pipelines/feature-dev.yaml',
      { Codex: {}, Vibe: {} },
    );

    assert.ok(result.errors.some(error => error.includes('cannot use workspace side effects')));
  });

  test('rejects direct workspace steps before approval', () => {
    const result = parsePipelineYaml(
      VALID_PIPELINE.replace('  - id: plan\n    use: plan', '  - id: edit_early\n    use: edit'),
      '/repo/.acp/pipelines/feature-dev.yaml',
      { Codex: {}, Vibe: {} },
    );

    assert.ok(result.errors.some(error => error.includes('before an approval step')));
  });
});
