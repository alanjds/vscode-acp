# ADR-0002: React Webview Migration

**Status**: Accepted

## Context
Original webview implementation used vanilla HTML/JS/CSS. As features grew (chat history, tool calls, markdown rendering, file trees), the code became:
- Hard to maintain and extend
- No component reusability
- Manual DOM manipulation error-prone
- No state management
- Difficult to test

VS Code webviews support any frontend framework, and React is the team's standard.

## Decision
Migrated chat webview to React 18 with TypeScript. Key changes:

**Architecture**:
- React components for each message type (user, agent, tool call, error)
- State managed via React hooks and context
- Message history as immutable array
- Webpack 5 for bundling

**Components**:
- `ChatWebviewProvider` - VS Code integration layer
- `MessageBubble`, `Picker`, `PlanBlock`, `ThoughtBlock`, `TurnBlock`, `TurnTools` - reusable UI components
- CSS modules for scoped styling

**Build**:
- Webpack config with TypeScript loader
- Separate compilation from extension build
- Hot reload for development

## Consequences
**Positive**:
- Clean component hierarchy
- Type-safe props and state
- Easier to add new message types
- Better developer experience
- Reusable component library

**Negative**:
- Added ~5MB of dependencies (react, react-dom, webpack)
- Build pipeline more complex
- Bundling adds ~200ms to extension activation
- Learning curve for contributors unfamiliar with React

## Alternatives Considered
- Vue.js - rejected, team more familiar with React
- Svelte - rejected, less ecosystem support
- LitElement - rejected, not type-safe enough
- Keep vanilla JS - rejected, unsustainable for growing feature set
