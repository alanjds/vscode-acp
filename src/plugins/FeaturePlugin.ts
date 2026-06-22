import type * as vscode from 'vscode';

export interface FeaturePlugin<TContext> {
  readonly id: string;
  activate(context: TContext): vscode.Disposable;
}

