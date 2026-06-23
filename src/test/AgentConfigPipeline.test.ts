import * as assert from 'assert';
import * as vscode from 'vscode';

import { getAgentNames } from '../config/AgentConfig';
import { repoRoot } from './repoRoot';

suite('AgentConfig pipeline', () => {
  let originalGetConfiguration: typeof vscode.workspace.getConfiguration;

  setup(() => {
    originalGetConfiguration = vscode.workspace.getConfiguration;
  });

  teardown(() => {
    vscode.workspace.getConfiguration = originalGetConfiguration;
  });

  test('adds virtual pipeline agent when enabled', () => {
    vscode.workspace.getConfiguration = function(_section) {
      return {
        get: (key: string, defaultValue?: unknown) => {
          switch (key) {
            case 'agents':
              return {
                'Gemini CLI': { command: 'gemini' },
                'Codex CLI': { command: 'codex' },
                'Claude Code': { command: 'claude' },
                'Cursor CLI': { command: 'cursor' },
                'Cursor Sandcastle': { transport: 'sandcastle', provider: 'cursor', model: 'composer-2' },
                Vibe: { command: 'vibe' },
              };
            case 'pipeline.enabled':
              return true;
            default:
              return defaultValue;
          }
        },
      } as any;
    };

    assert.ok(getAgentNames().includes('Plan Execute Verify'));
  });

  test('does not add virtual pipeline agent when disabled', () => {
    vscode.workspace.getConfiguration = function(_section) {
      return {
        get: (key: string, defaultValue?: unknown) => {
          switch (key) {
            case 'agents':
              return { 'Codex CLI': { command: 'codex' } };
            case 'pipeline.enabled':
              return false;
            default:
              return defaultValue;
          }
        },
      } as any;
    };

    assert.deepStrictEqual(getAgentNames(), ['Codex CLI']);
  });

  test('loads virtual pipeline agents from explicit workspace cwd', () => {
    vscode.workspace.getConfiguration = function(_section) {
      return {
        get: (key: string, defaultValue?: unknown) => {
          switch (key) {
            case 'agents':
              return {
                'Gemini CLI': { command: 'gemini' },
                'Codex CLI': { command: 'codex' },
                'Claude Code': { command: 'claude' },
                'Cursor CLI': { command: 'cursor' },
                'Cursor Sandcastle': { transport: 'sandcastle', provider: 'cursor', model: 'composer-2' },
                Vibe: { command: 'vibe' },
              };
            case 'pipeline.enabled':
              return true;
            default:
              return defaultValue;
          }
        },
      } as any;
    };

    const names = getAgentNames(repoRoot());
    assert.ok(names.includes('Plan Execute Verify'));
    assert.ok(names.includes('Feature Team'));
  });
});
