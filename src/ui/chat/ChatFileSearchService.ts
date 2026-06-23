import * as path from 'path';
import * as vscode from 'vscode';

import { logError } from '../../utils/Logger';
import {
  createFileSearchIndex,
  searchIndexedFiles,
  type FileSearchEntry,
  type IndexedFile,
} from '../FileSearchIndex';

const FILE_SEARCH_RESULT_LIMIT = 30;
const FILE_SEARCH_INDEX_LIMIT = 5000;

/**
 * Workspace file index for @-mention search in the chat composer.
 */
export class ChatFileSearchService implements vscode.Disposable {
  private indexPromise: Promise<{ index: ReturnType<typeof createFileSearchIndex>; files: IndexedFile[] }> | null = null;
  private readonly disposables: vscode.Disposable[] = [];

  constructor() {
    this.disposables.push(
      vscode.workspace.onDidCreateFiles(() => this.invalidate()),
      vscode.workspace.onDidDeleteFiles(() => this.invalidate()),
      vscode.workspace.onDidRenameFiles(() => this.invalidate()),
      vscode.workspace.onDidChangeWorkspaceFolders(() => this.invalidate()),
    );
  }

  async search(query: string): Promise<FileSearchEntry[]> {
    try {
      const { index, files } = await this.getIndex();
      return disambiguateFileSearchResults(
        searchIndexedFiles(index, files, query.replace(/\\/g, '/'), FILE_SEARCH_RESULT_LIMIT),
      );
    } catch (e) {
      logError('File search failed', e);
      return [];
    }
  }

  invalidate(): void {
    this.indexPromise = null;
  }

  dispose(): void {
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
    this.disposables.length = 0;
  }

  private getIndex(): Promise<{ index: ReturnType<typeof createFileSearchIndex>; files: IndexedFile[] }> {
    this.indexPromise ??= this.buildIndex();
    return this.indexPromise;
  }

  private async buildIndex(): Promise<{ index: ReturnType<typeof createFileSearchIndex>; files: IndexedFile[] }> {
    const uris = await vscode.workspace.findFiles(
      '**/*',
      '**/{node_modules,.git,dist,out}/**',
      FILE_SEARCH_INDEX_LIMIT,
    );

    const files = uris.map((uri, index) => {
      const workspaceFolder = vscode.workspace.getWorkspaceFolder(uri);
      const relativePath = workspaceFolder
        ? path.relative(workspaceFolder.uri.fsPath, uri.fsPath).replace(/\\/g, '/')
        : uri.fsPath.replace(/\\/g, '/');

      return {
        id: `${index}:${relativePath}`,
        path: relativePath,
        name: uri.fsPath.split(/[\\/]/).pop() || relativePath,
        content: '',
      };
    });

    return {
      index: createFileSearchIndex(files),
      files,
    };
  }
}

function disambiguateFileSearchResults(results: FileSearchEntry[]): FileSearchEntry[] {
  const byName = new Map<string, FileSearchEntry[]>();
  for (const result of results) {
    const bucket = byName.get(result.name) ?? [];
    bucket.push(result);
    byName.set(result.name, bucket);
  }

  return results.map(result => {
    const duplicates = byName.get(result.name) ?? [];
    if (duplicates.length <= 1) {
      return result;
    }
    return {
      ...result,
      name: shortestUniqueSuffix(result.path, duplicates.map(candidate => candidate.path)),
    };
  });
}

function shortestUniqueSuffix(pathValue: string, allPaths: string[]): string {
  const parts = pathValue.split('/').filter(Boolean);
  for (let count = 1; count <= parts.length; count += 1) {
    const suffix = parts.slice(parts.length - count).join('/');
    const matches = allPaths.filter(candidate => {
      const candidateParts = candidate.split('/').filter(Boolean);
      return candidateParts.slice(candidateParts.length - count).join('/') === suffix;
    });
    if (matches.length === 1) {
      return suffix;
    }
  }
  return pathValue;
}
