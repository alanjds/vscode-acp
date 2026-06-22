import * as vscode from 'vscode';

import { logError } from '../utils/Logger';

export type ReactShellViewKind = 'chat' | 'debug';

export async function getReactShellHtmlContent(
  extensionUri: vscode.Uri,
  webview: vscode.Webview,
  viewKind: ReactShellViewKind,
): Promise<string> {
  const templateUri = vscode.Uri.joinPath(extensionUri, 'resources', 'webview', 'chat.html');
  const processShimUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, 'resources', 'webview', 'process-shim.js'),
  );
  const scriptUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, 'resources', 'webview', 'dist', 'chat.js'),
  );
  const styleUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, 'resources', 'webview', 'dist', 'chat.css'),
  );
  const codiconStyleUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, 'resources', 'webview', 'dist', 'codicon.css'),
  );
  const htmxUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, 'resources', 'webview', 'htmx.min.js'),
  );

  try {
    const bytes = await vscode.workspace.fs.readFile(templateUri);
    return Buffer.from(bytes).toString('utf8')
      .replace(/__CSP_SOURCE__/g, webview.cspSource)
      .replace(/__PROCESS_SHIM_URI__/g, processShimUri.toString())
      .replace(/__SCRIPT_URI__/g, scriptUri.toString())
      .replace(/__STYLE_URI__/g, styleUri.toString())
      .replace(/__CODICON_STYLE_URI__/g, codiconStyleUri.toString())
      .replace(/__HTMX_URI__/g, htmxUri.toString())
      .replace(/__VIEW_KIND__/g, viewKind);
  } catch (e: any) {
    logError(`Failed to load ${viewKind} webview template`, e);
    return '<!DOCTYPE html><html><body><pre>Failed to load React shell webview template</pre></body></html>';
  }
}
