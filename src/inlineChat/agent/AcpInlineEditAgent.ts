import { getAgentNames, getAgentConfig } from '../../config/AgentConfig';
import { isPipelineVirtualAgentName } from '../../config/PipelineCatalog';
import { SessionManager } from '../../core/SessionManager';
import { WorkspaceIdentity } from '../../core/WorkspaceIdentity';
import { AcpAgentRunner } from '../../pipeline/AcpAgentRunner';
import { getSafeFenceMarker } from '../../ui/EditorContext';
import { InlineEditRequest, InlineEditResult } from '../InlineChatTypes';
import { InlineEditAgent, InlineEditOptions } from './InlineEditAgent';

export class AcpInlineEditAgent implements InlineEditAgent {
  private readonly runner: AcpAgentRunner;

  constructor(
    private readonly workspaceIdentity: () => WorkspaceIdentity,
    private readonly sessionManager: SessionManager,
  ) {
    this.runner = new AcpAgentRunner(() => this.workspaceIdentity().cwd);
  }

  async generateEdit(request: InlineEditRequest, options?: InlineEditOptions): Promise<InlineEditResult> {
    const agentName = this.resolveAgentName();
    const prompt = this.buildPrompt(request);
    const responseText = await this.runner.run(agentName, prompt, {
      signal: options?.signal,
    });
    return this.parseResponse(request, responseText);
  }

  private resolveAgentName(): string {
    const cwd = this.workspaceIdentity().cwd;
    const activeAgentName = this.sessionManager.getActiveSession()?.agentName;

    if (activeAgentName && !isPipelineVirtualAgentName(activeAgentName, cwd)) {
      return activeAgentName;
    }

    const names = getAgentNames(cwd).filter(name => !isPipelineVirtualAgentName(name, cwd));
    if (names.length === 0) {
      throw new Error('No ACP agent configured. Add agents in acp.agents settings.');
    }

    return names[0];
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
      const agentName = this.sessionManager.getActiveSession()?.agentName ?? this.resolveAgentName();
      const cfg = getAgentConfig(agentName);
      return cfg?.displayName ?? agentName;
    } catch {
      return 'ACP Agent';
    }
  }
}
