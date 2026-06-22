import * as vscode from 'vscode';

import { startExtensionRuntime } from './runtime/ExtensionRuntime';
import { log } from './utils/Logger';

export function activate(context: vscode.ExtensionContext): void {
  startExtensionRuntime(context);
}

export function deactivate(): void {
  log('ACP Client extension deactivated.');
}
