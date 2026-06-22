---
name: unit-tests
description: Add, update, and run focused unit or integration tests with the repository's existing test harness. Use when Codex implements or fixes tests, runs test suites, verifies a change with tests, or works with VS Code extension tests driven by vscode-test or @vscode/test-electron. Prevent repeated sandbox failures by identifying Electron-based runners before execution and requesting an escalated, no-download targeted run immediately when required.
---

# Unit Tests

Use the repository's existing framework, conventions, fixtures, and commands. Keep tests deterministic and focused on observable behavior.

## Workflow

1. Inspect the test setup before editing or running anything:
   - Read the relevant package/build configuration and nearby tests.
   - Identify whether the runner is an in-process unit runner or launches VS Code/Electron.
   - Find the narrowest supported file, suite, or test-name filter.
2. Add or update the smallest test that proves the requested behavior. Avoid production changes unless the user also asked for implementation or a fix.
3. Run cheap static checks needed by the test harness, such as test compilation or type checking.
4. Run the narrowest relevant tests first. Expand only when they pass or when broader coverage is necessary.
5. Report the exact commands and results. Distinguish passing static checks from tests that actually executed.

## VS Code And Electron Runners

Treat `vscode-test`, `@vscode/test-cli`, `@vscode/test-electron`, `runTests`, and commands that launch a VS Code executable as Electron integration runners, not ordinary Node unit runners.

Before launching one:

1. Inspect its configuration and resolve the intended VS Code executable/version.
2. Prefer an already-installed local VS Code or cached test binary.
3. Prevent downloads when a local executable is available. Preserve the repository's supported configuration rather than inventing a new harness.
4. Request escalated execution on the first targeted Electron run because macOS sandbox restrictions can abort Electron with `SIGABRT` or block required process/network access.
5. In the approval justification, state that the command launches the local VS Code/Electron test host and must run outside the sandbox; state explicitly that no download is intended.

Do not first run a known Electron suite inside the sandbox merely to confirm the predictable failure. Do not describe compile, type, or lint success as test success.

If no local or cached VS Code executable exists and obtaining one requires network access, stop and explain that prerequisite before downloading anything unless the user already authorized downloads.

## Failure Handling

- If tests fail normally, diagnose the assertion, setup, or production behavior from the test output.
- If Electron exits with `SIGABRT`, sandbox-denial messages, blocked child-process access, or a network denial despite using a local binary, rerun the same targeted command with escalation; do not repeat the sandboxed attempt.
- If escalation is denied, report the targeted command that remains unexecuted and the checks that did pass. Do not imply that the suite passed.
- Avoid broad retries. Change one relevant condition at a time and retain the narrow test filter.

## Repository Defaults

For this VS Code extension repository:

- Read `package.json` and `.vscode-test.mjs` before choosing commands.
- Use `npm run compile-tests` for test TypeScript compilation when relevant.
- Treat `npm test` / `vscode-test` as an Electron integration run.
- Prefer the runner's supported test-name or file filter for targeted verification.
- Use the locally resolved VS Code installation or cache and request an escalated targeted run immediately, with no download.
