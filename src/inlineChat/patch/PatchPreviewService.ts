import * as vscode from 'vscode';
import { PatchEdit } from './PatchTypes';

/**
 * Service for previewing patches before applying
 */
export class PatchPreviewService {
  private decorations: vscode.TextEditorDecorationType[] = [];

  /**
   * Show a preview of what the patch will change
   */
  showPreview(editor: vscode.TextEditor, edits: PatchEdit[]): void {
    // Clear existing decorations
    this.clearPreview();

    const decoration = vscode.window.createTextEditorDecorationType({
      backgroundColor: new vscode.ThemeColor('editorBracketMatch.background'),
      isWholeLine: false,
      rangeBehavior: vscode.DecorationRangeBehavior.ClosedOpen,
    });

    const decorationOptions: vscode.DecorationOptions[] = edits.map(edit => ({
      range: edit.range,
      hoverMessage: new vscode.MarkdownString(`**Will be replaced with:**\n\n\`\`\`\n${edit.newText}\n\`\`\``),
    }));

    editor.setDecorations(decoration, decorationOptions);
    this.decorations.push(decoration);
  }

  /**
   * Clear the current preview
   */
  clearPreview(): void {
    for (const decoration of this.decorations) {
      decoration.dispose();
    }
    this.decorations = [];
  }

  /**
   * Show a diff view of the changes
   */
  async showDiffView(
    editor: vscode.TextEditor,
    originalText: string,
    modifiedText: string
  ): Promise<void> {
    const document = await vscode.workspace.openTextDocument({
      content: `--- Original\n+++ Modified\n${this.generateDiff(originalText, modifiedText)}`,
      language: 'diff'
    });

    await vscode.window.showTextDocument(document, {
      preview: true,
      viewColumn: vscode.ViewColumn.Beside
    });
  }

  /**
   * Simple diff generation (for demonstration)
   */
  private generateDiff(original: string, modified: string): string {
    const originalLines = original.split('\n');
    const modifiedLines = modified.split('\n');
    
    const diffLines: string[] = [];
    
    for (let i = 0; i < Math.max(originalLines.length, modifiedLines.length); i++) {
      const origLine = originalLines[i];
      const modLine = modifiedLines[i];
      
      if (origLine !== modLine) {
        if (origLine !== undefined) {
          diffLines.push(`- ${origLine}`);
        }
        if (modLine !== undefined) {
          diffLines.push(`+ ${modLine}`);
        }
      } else {
        diffLines.push(`  ${origLine || modLine || ''}`);
      }
    }
    
    return diffLines.join('\n');
  }

  dispose(): void {
    this.clearPreview();
  }
}
