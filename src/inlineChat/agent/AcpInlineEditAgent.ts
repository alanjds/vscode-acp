import type { EphemeralAgentRunner } from '../../core/EphemeralAgentRunner';
import { WorkspaceIdentity } from '../../core/WorkspaceIdentity';
import { getSafeFenceMarker } from '../../ui/EditorContext';
import { InlineEditRequest, InlineEditResult } from '../InlineChatTypes';
import type { ActiveAgentResolver } from './ActiveAgentResolver';
import { InlineEditAgent, InlineEditOptions } from './InlineEditAgent';

export class AcpInlineEditAgent implements InlineEditAgent {
  constructor(
    private readonly workspaceIdentity: () => WorkspaceIdentity,
    private readonly resolver: ActiveAgentResolver,
    private readonly ephemeralRunner: EphemeralAgentRunner,
  ) {}

  async generateEdit(request: InlineEditRequest, options?: InlineEditOptions): Promise<InlineEditResult> {
    const agentName = this.resolver.resolveRunnableAgent().name;
    const prompt = this.buildPrompt(request);
    const run = await this.ephemeralRunner.run({
      workspaceCwd: this.workspaceIdentity().cwd,
      agentName,
      promptText: prompt,
      signal: options?.signal,
      sideEffects: 'none',
    });

    return this.parseResponse(request, run.text);
  }

  private buildPrompt(request: InlineEditRequest): string {
    const { selection, selectedText, contextText, prompt, fileName, languageId } = request;
    const fence = getSafeFenceMarker(contextText);
    const lang = languageId || 'text';

    const selectionLine = selection.isEmpty
      ? `Curseur : ligne ${selection.active.line + 1}`
      : `Sélection : lignes ${selection.start.line + 1}–${selection.end.line + 1}`;

    const lines = [
      `Fichier : ${fileName} (${languageId})`,
      selectionLine,
      '',
      `${fence}${lang}`,
      contextText,
      fence,
    ];

    if (selectedText.trim()) {
      const selectionFence = getSafeFenceMarker(selectedText);
      lines.push('', 'Texte sélectionné :', `${selectionFence}${lang}`, selectedText, selectionFence);
    }

    lines.push(
      '',
      `Demande : ${prompt}`,
      '',
      'Réponds UNIQUEMENT avec le code de remplacement pour la plage indiquée, sans explication.',
    );

    return lines.join('\n');
  }

  private parseResponse(request: InlineEditRequest, responseText: string): InlineEditResult {
    const newText = this.stripCodeFences(responseText.trim());
    const { selection } = request;

    const range = selection.isEmpty
      ? {
          start: {
            line: selection.active.line,
            character: selection.active.character,
          },
          end: {
            line: selection.active.line,
            character: selection.active.character,
          },
        }
      : {
          start: {
            line: selection.start.line,
            character: selection.start.character,
          },
          end: {
            line: selection.end.line,
            character: selection.end.character,
          },
        };

    const firstLine = newText.split('\n')[0]?.trim() || 'Proposal ready';
    const summary = firstLine.length > 80 ? `${firstLine.slice(0, 77)}...` : firstLine;

    return {
      summary,
      edits: [{ range, newText }],
    };
  }

  private stripCodeFences(text: string): string {
    const match = text.match(/^```[\w-]*\n?([\s\S]*?)\n?```$/);
    if (match) {
      return match[1].trimEnd();
    }
    return text;
  }

  getDisplayName(): string {
    try {
      return this.resolver.resolveRunnableAgent().displayName;
    } catch {
      return 'ACP Agent';
    }
  }
}
