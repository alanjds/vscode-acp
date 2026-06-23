import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { validateAgentTeamDefinition } from '../config/AgentTeamConfig';
import { loadWorkspaceTeamEntries } from '../config/AgentTeamCatalog';
import { compileTeamToPipeline } from '../pipeline/AgentTeamCompiler';
import { InstructionResolver } from '../instructions/InstructionResolver';

const AGENTS = {
  'Codex CLI': { command: 'codex' },
  Vibe: { command: 'vibe' },
  'Claude Code': { command: 'claude' },
};

function writeTeamFixture(root: string, relativePath: string, content: string): string {
  const filePath = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf8');
  return filePath;
}

suite('Agent teams', () => {
  test('validates a minimal team with three required roles', () => {
    const result = validateAgentTeamDefinition(
      {
        version: 1,
        id: 'feature-team',
        title: 'Feature Team',
        roles: {
          planner: { agent: 'Codex CLI', instructions: '.acp/agents/planner.md' },
          implementer: { agent: 'Vibe', instructions: '.acp/agents/implementer.md' },
          reviewer: { agent: 'Claude Code', instructions: '.acp/agents/reviewer.md' },
        },
      },
      '/repo/.acp/teams/feature-team.yaml',
      AGENTS,
    );

    assert.deepStrictEqual(result.errors, []);
    assert.ok(result.definition);
    assert.strictEqual(result.definition?.roles.implementer.agent, 'Vibe');
  });

  test('rejects missing required role', () => {
    const result = validateAgentTeamDefinition(
      {
        version: 1,
        id: 'broken-team',
        title: 'Broken Team',
        roles: {
          planner: { agent: 'Codex CLI', instructions: '.acp/agents/planner.md' },
          implementer: { agent: 'Vibe', instructions: '.acp/agents/implementer.md' },
        },
      },
      '/repo/.acp/teams/broken-team.yaml',
      AGENTS,
    );

    assert.ok(result.errors.some(error => error.includes('roles.reviewer')));
  });

  test('rejects unknown agent and forbidden primitive fields', () => {
    const result = validateAgentTeamDefinition(
      {
        version: 1,
        id: 'bad-team',
        title: 'Bad Team',
        roles: {
          planner: { agent: 'Missing Agent', instructions: '.acp/agents/planner.md' },
          implementer: { agent: 'Vibe', instructions: '.acp/agents/implementer.md', sideEffects: 'workspace' },
          reviewer: { agent: 'Claude Code', instructions: '.acp/agents/reviewer.md' },
        },
      },
      '/repo/.acp/teams/bad-team.yaml',
      AGENTS,
    );

    assert.ok(result.errors.some(error => error.includes('Missing Agent')));
    assert.ok(result.errors.some(error => error.includes('sideEffects')));
  });

  test('InstructionResolver rejects paths outside workspace', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'acp-team-'));
    const teamFile = writeTeamFixture(root, '.acp/teams/feature-team.yaml', 'version: 1\n');
    const resolver = new InstructionResolver(root);

    const outcome = resolver.resolve('../outside.md', teamFile);
    assert.ok('error' in outcome);
  });

  test('InstructionResolver rejects files above maxBytes', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'acp-team-'));
    const teamFile = writeTeamFixture(root, '.acp/teams/feature-team.yaml', 'version: 1\n');
    writeTeamFixture(root, '.acp/agents/huge.md', 'x'.repeat(32));
    const resolver = new InstructionResolver(root, 16);

    const outcome = resolver.resolve('.acp/agents/huge.md', teamFile);
    assert.ok('error' in outcome);
    assert.match(outcome.error, /max size/i);
  });

  test('compiles team to plan-execute-verify-like pipeline with reviewer step', () => {
    const team = {
      version: 1 as const,
      id: 'feature-team',
      title: 'Feature Team',
      roles: {
        planner: { agent: 'Codex CLI', instructions: '.acp/agents/planner.md' },
        implementer: { agent: 'Vibe', instructions: '.acp/agents/implementer.md' },
        reviewer: { agent: 'Claude Code', instructions: '.acp/agents/reviewer.md' },
      },
    };

    const compiled = compileTeamToPipeline(
      team,
      {
        planner: 'Plan with care.',
        implementer: 'Implement exactly.',
        reviewer: 'Review the diff.',
      },
      '/repo/.acp/teams/feature-team.yaml',
      AGENTS,
    );

    assert.deepStrictEqual(compiled.errors, []);
    assert.ok(compiled.pipeline);
    assert.deepStrictEqual(
      compiled.pipeline!.steps.map(step => step.id),
      ['planner', 'approval', 'implementer', 'reviewer'],
    );
    assert.strictEqual(compiled.pipeline!.primitives.implementer.sideEffects, 'workspace');
    assert.match(compiled.pipeline!.primitives.planner.prompt, /Plan with care/);
    assert.match(compiled.pipeline!.primitives.reviewer.prompt, /Review the diff/);
    assert.deepStrictEqual(compiled.pipeline!.metadata?.roleByStepId.implementer, 'implementer');
    assert.strictEqual(compiled.pipeline!.metadata?.instructionsByRole.reviewer, 'Review the diff.');
  });

  test('loads valid team entries from workspace directory', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'acp-team-load-'));
    writeTeamFixture(root, '.acp/agents/planner.md', 'Plan.');
    writeTeamFixture(root, '.acp/agents/implementer.md', 'Implement.');
    writeTeamFixture(root, '.acp/agents/reviewer.md', 'Review.');
    writeTeamFixture(
      root,
      '.acp/teams/feature-team.yaml',
      [
        'version: 1',
        'id: feature-team',
        'title: Feature Team',
        'roles:',
        '  planner:',
        '    agent: Codex CLI',
        '    instructions: .acp/agents/planner.md',
        '  implementer:',
        '    agent: Vibe',
        '    instructions: .acp/agents/implementer.md',
        '  reviewer:',
        '    agent: Claude Code',
        '    instructions: .acp/agents/reviewer.md',
      ].join('\n'),
    );

    const entries = loadWorkspaceTeamEntries(root, AGENTS);
    assert.strictEqual(entries.length, 1);
    assert.strictEqual(entries[0].displayName, 'Feature Team');
    assert.deepStrictEqual(entries[0].errors, []);
    assert.ok(entries[0].pipeline);
  });
});
