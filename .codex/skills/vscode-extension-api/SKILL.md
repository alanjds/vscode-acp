---
name: vscode-extension-api
description: Guidance for building, running, debugging, testing, reviewing, and publishing Visual Studio Code extensions with the VS Code Extension API. Use when Codex works on VS Code extension projects, package.json contribution points, activation events, commands, webviews, language extensions, debugger extensions, extension tests, Marketplace publishing, or Extension API capability questions.
---

# VS Code Extension API

Use this skill when the task concerns a Visual Studio Code extension or the VS Code Extension API. Prefer the repository's existing extension structure and scripts before introducing new scaffolding.

## Workflow

1. Inspect the extension project first:
   - Read `package.json` for `engines.vscode`, `activationEvents`, `contributes`, extension scripts, and dependencies.
   - Read `src/extension.*` or the configured `main` entrypoint.
   - Check test setup, bundler config, and README only when needed for the requested task.
2. Classify the work:
   - **Workbench/UI**: commands, views, tree views, menus, status bar, settings, walkthroughs.
   - **Editor/language**: diagnostics, completion, hover, CodeLens, semantic tokens, formatters, language server integration.
   - **Webview**: custom HTML/CSS/JS surfaces, message passing, CSP, resource URIs, state restoration.
   - **Debugging**: debug adapters, debug configuration providers, custom runtime support.
   - **Lifecycle/quality**: activation, disposables, configuration, tests, packaging, publishing.
3. Use official VS Code concepts and APIs. If exact API names, contribution schema, or current behavior matter, verify against the local dependency types and, when internet is available or requested, the official VS Code docs.
4. Implement narrowly. Keep activation cheap, register disposables in `context.subscriptions`, and avoid broad activation events unless the extension truly needs them.
5. Validate with the project's own commands, usually `npm test`, `npm run compile`, `npm run lint`, `npm run package`, or the equivalents already defined in `package.json`.

## Reference

Read `references/extension-api-overview.md` when you need the provided documentation summary, official documentation areas, sample links, or support links.

Useful local search patterns:

```bash
rg -n '"activationEvents"|"contributes"|"engines"|vscode\\.commands|createWebviewPanel|register(TreeDataProvider|Command|CompletionItemProvider|HoverProvider|DebugConfigurationProvider)' package.json src test
```

## Implementation Notes

- Treat `package.json` contribution points and runtime registrations as a pair: a command, view, language, debugger, or configuration often needs both manifest metadata and activation/runtime code.
- Keep command IDs stable and namespaced, usually `<extension-id>.<commandName>`.
- Use `vscode.Uri`, `context.extensionUri`, and `webview.asWebviewUri` for extension resources. Do not embed raw local filesystem paths in webviews.
- Add every registration, watcher, status bar item, output channel, or provider to `context.subscriptions` unless there is a deliberate longer lifecycle.
- For webviews, set a restrictive Content Security Policy, avoid inline script by default, and validate all messages received from the webview.
- For language features, prefer VS Code provider APIs for small features and an LSP server when behavior is large, shared, or language-server-shaped.
- For tests, prefer `@vscode/test-electron` or the existing project harness. Keep integration tests focused on activation, commands, and visible API behavior.

## Publishing And Compatibility

- Check `engines.vscode` before using newer APIs.
- Review `CHANGELOG`, `README`, categories, keywords, icon, repository, license, and Marketplace metadata before packaging.
- Use `vsce package` or the repository's publishing script if present.
- For monthly API changes, consult VS Code release notes sections for extension authoring and proposed APIs.
