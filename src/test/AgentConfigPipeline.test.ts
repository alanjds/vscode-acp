import * as assert from 'assert';
import * as vscode from 'vscode';

import { getAgentNames } from '../config/AgentConfig';

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
              return { Codex: { command: 'codex' }, Vibe: { command: 'vibe' } };
            case 'pipeline.enabled':
              return true;
            case 'pipeline.virtualAgentName':
              return 'Pipeline';
            default:
              return defaultValue;
          }
        },
      } as any;
    };

    assert.deepStrictEqual(getAgentNames(), ['Codex', 'Vibe', 'Pipeline', 'Gemini Plan -> Vibe Implement']);
  });

  test('does not add virtual pipeline agent when disabled', () => {
    vscode.workspace.getConfiguration = function(_section) {
      return {
        get: (key: string, defaultValue?: unknown) => {
          switch (key) {
            case 'agents':
              return { Codex: { command: 'codex' } };
            case 'pipeline.enabled':
              return false;
            default:
              return defaultValue;
          }
        },
      } as any;
    };

    assert.deepStrictEqual(getAgentNames(), ['Codex']);
  });
});

