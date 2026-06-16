import * as vscode from 'vscode';
import { PatchEdit } from './PatchTypes';

/**
 * Service for validating patches before applying
 */
export class PatchValidator {
  /**
   * Validate that a patch can be applied to the current document state
   */
  validate(
    document: vscode.TextDocument,
    edits: PatchEdit[],
    documentVersion: number
  ): { valid: boolean; error?: string } {
    // Check if document version matches
    if (document.version !== documentVersion) {
      return {
        valid: false,
        error: 'Document has been modified since patch was generated'
      };
    }

    // Check that all ranges are within document bounds
    for (const edit of edits) {
      const range = edit.range;
      
      // Check line numbers
      if (range.start.line < 0 || range.start.line >= document.lineCount) {
        return {
          valid: false,
          error: `Edit range line ${range.start.line} is out of bounds`
        };
      }
      
      if (range.end.line < 0 || range.end.line >= document.lineCount) {
        return {
          valid: false,
          error: `Edit range line ${range.end.line} is out of bounds`
        };
      }

      // Check character positions
      const startLine = document.lineAt(range.start.line);
      if (range.start.character < 0 || range.start.character > startLine.text.length) {
        return {
          valid: false,
          error: `Edit start character ${range.start.character} is out of bounds on line ${range.start.line}`
        };
      }

      const endLine = document.lineAt(range.end.line);
      if (range.end.character < 0 || range.end.character > endLine.text.length) {
        return {
          valid: false,
          error: `Edit end character ${range.end.character} is out of bounds on line ${range.end.line}`
        };
      }
    }

    return { valid: true };
  }

  /**
   * Check if edits overlap with each other
   */
  checkOverlaps(edits: PatchEdit[]): { hasOverlaps: boolean; overlappingPairs: [number, number][] } {
    const overlappingPairs: [number, number][] = [];

    for (let i = 0; i < edits.length; i++) {
      for (let j = i + 1; j < edits.length; j++) {
        if (this.rangesOverlap(edits[i].range, edits[j].range)) {
          overlappingPairs.push([i, j]);
        }
      }
    }

    return {
      hasOverlaps: overlappingPairs.length > 0,
      overlappingPairs
    };
  }

  /**
   * Check if two ranges overlap
   */
  private rangesOverlap(range1: vscode.Range, range2: vscode.Range): boolean {
    // Check if ranges are on different lines
    if (range1.start.line > range2.end.line || range2.start.line > range1.end.line) {
      return false;
    }

    // Check if ranges are on the same line
    if (range1.start.line === range2.start.line && range1.end.line === range2.end.line) {
      return range1.start.character < range2.end.character && range2.start.character < range1.end.character;
    }

    // Ranges span multiple lines and overlap
    return true;
  }
}
