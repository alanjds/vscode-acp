---
name: refactor-large-ts-classes
description: Refactor oversized TypeScript classes in VS Code extensions. Use when a class mixes multiple responsibilities (UI, commands, business logic, FS) or has many private methods that belong elsewhere.
---

# Refactor Large TypeScript Classes

Refactor oversized TypeScript classes in a VS Code extension without changing behavior.

## Goal

Improve readability, testability, separation of concerns, and maintainability while preserving the public API and runtime behavior.

## Typical target architecture for a VS Code extension

Prefer this structure:

```txt
src/
  extension.ts         # Activation, wiring, subscriptions
  commands/            # Command handlers (validate input, call services)
  services/            # Business logic coordination
  vscode/              # Wrappers around VS Code APIs (Window, Workspace)
  repositories/        # Filesystem or data access
  domain/              # Pure logic (no VS Code imports), highly testable
  config/              # Extension configuration logic
  test/                # Unit and integration tests
```

## Refactoring Process

### 1. Map Responsibilities
For each large class, identify groups of methods by role:
- Command handling
- Configuration
- VS Code UI interactions
- File system access
- Business logic / Domain parsing
- External API calls

### 2. Detect Extraction Candidates
Look for:
- Private methods used only together.
- Repeated parameter groups.
- Logic that does not need `this` or the `vscode` API.
- Methods with names from different domains (e.g., `updateUI` vs `calculateDiff`).

### 3. Extraction Steps
1. **Extract pure functions first**: Move logic that does not depend on VS Code into `domain/`.
2. **Extract services**: When a group of methods represents a use case, create a service.
3. **Extract VS Code adapters**: Isolate direct calls to `vscode.window`, `vscode.workspace`, `vscode.commands`, etc.
4. **Keep command API stable**: Do not rename command IDs in `package.json`.

## Rules

- **Preserve Behavior**: Do not change how the extension behaves for the user.
- **Surgical Edits**: Prefer small, safe extraction steps over a total rewrite.
- **Testability**: Prioritize tests for extracted domain logic and services.
- **Dependency Injection**: Pass dependencies (like VS Code adapters) to constructors instead of using global state.
- **No Overengineering**: Avoid generic "managers" or complex patterns unless they solve a specific problem.

## Definition of Done

- The large class has one clear responsibility.
- VS Code API calls are isolated.
- Pure logic is testable without VS Code.
- Existing behavior is preserved and TypeScript builds successfully.
