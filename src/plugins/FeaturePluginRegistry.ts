import type * as vscode from 'vscode';

import type { FeaturePlugin } from './FeaturePlugin';

export interface FeaturePluginRegistration<TContext = unknown> {
  plugin: FeaturePlugin<TContext>;
  context: TContext;
}

export function activateFeaturePlugins(
  registrations: readonly FeaturePluginRegistration<any>[],
): vscode.Disposable {
  const ids = new Set<string>();
  const activated: vscode.Disposable[] = [];

  try {
    for (const registration of registrations) {
      if (ids.has(registration.plugin.id)) {
        throw new Error(`Feature plugin "${registration.plugin.id}" is registered more than once.`);
      }
      ids.add(registration.plugin.id);
      activated.push(registration.plugin.activate(registration.context));
    }
  } catch (error) {
    disposeReverse(activated);
    throw error;
  }

  let disposed = false;
  return {
    dispose: () => {
      if (disposed) {
        return;
      }
      disposed = true;
      disposeReverse(activated);
    },
  };
}

function disposeReverse(disposables: readonly vscode.Disposable[]): void {
  for (let index = disposables.length - 1; index >= 0; index -= 1) {
    disposables[index].dispose();
  }
}

