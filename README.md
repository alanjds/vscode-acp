# ACP Client for VS Code

A [Visual Studio Code extension](https://marketplace.visualstudio.com/items?itemName=damien-huyet.acp-client) that provides a client for the [Agent Client Protocol (ACP)](https://agentclientprotocol.com/) — connect to any ACP-compatible AI coding agent directly from your editor.

> [!NOTE]
> This is a fork of the original [vscode-acp](https://github.com/formulahendry/vscode-acp) by [formulahendry](https://github.com/formulahendry).

![ACP Client Screenshot](resources/screenshot.png)

## Features

- **Multi-Agent Support**: Connect to 12 pre-configured ACP agents or add your own
- **Vibe Agent Support**: Vibe is included as a pre-configured ACP agent via `vibe-acp`.
- **Single-Agent Focus**: One agent active at a time — seamlessly switch between agents
- **Per-Agent Session List**: Each agent in the Agents view is expandable into its previous sessions. Click a session to restore its history in the chat. Backed by `session/list` when the agent supports it, or by a local per-workspace cache otherwise.
- **Workspace-Scoped Session History**: Local cached sessions are scoped by workspace/cwd and agent.
- **Session Config Options**: Dynamic per-session selectors (mode, model, reasoning level, …) advertised by the agent are rendered automatically in the composer toolbar.
- **Editor Context Link**: Opt-in commands let users include current VS Code editor context in prompts.
- **Prompt Enrichment**: When context link is enabled, prompts can include current file, cursor location, selected text, language, and open editor list.
- **Context Handoff Across Agents**: Users can connect to another agent or open a session with the current context; context is injected once into the next prompt.
- **Debug Snapshots**: In-memory ACP/client traces can be viewed, refreshed, copied, or exported from the debug snapshot panel.
- **Interactive Chat**: Built-in chat panel with Markdown rendering, inline tool call display, and collapsible tool sections
- **LangGraph Pipelines**: Optional virtual agents can orchestrate ACP agents from workspace YAML workflows with reviewable approvals.
- **Thinking Display**: See agent reasoning in a collapsible block with streaming animation and elapsed time
- **Slash Commands**: Autocomplete popup for agent-provided commands with keyboard navigation
- **File Mentions**: Type `@` in the composer to search workspace files and send precise relative-path references to agents.
- **Mode & Model Picker**: Switch agent modes and models directly from the chat toolbar (kept for agents that haven't migrated to Session Config Options yet)
- **File System Integration**: Agents can read and write files in your workspace
- **Terminal Execution**: Agents can run commands with terminal output display
- **Permission Management**: Configurable auto-approve policies for agent actions
- **Protocol Traffic Logging**: Inspect all ACP JSON-RPC messages with request/response/notification labels
- **Agent Registry**: Browse and discover available ACP agents
- **Chat Persistence**: Conversations are preserved when switching panels

## Quick Start

1. Install: [Visual Studio Code Marketplace](https://marketplace.visualstudio.com/items?itemName=damien-huyet.acp-client) | [Open in VS Code](https://vscode.dev/redirect?url=vscode%3Aextension%2Fdamien-huyet.acp-client) | [Open VSX Marketplace](https://open-vsx.org/extension/damien-huyet/acp-client)
2. Open the ACP Client panel from the Activity Bar (ACP icon)
3. Click **+** to add an agent configuration, or use the defaults
4. Click an agent to connect
5. Start chatting!

## Requirements

- Node.js 18+ (for spawning agent processes)
- An ACP-compatible agent installed or available via `npx`

## Pre-configured Agents

The extension comes with default configurations for 12 agents:

| Agent | Command |
|-------|---------|
| GitHub Copilot | `npx @github/copilot-language-server@latest --acp` |
| Claude Code | `npx @agentclientprotocol/claude-agent-acp@latest` |
| Gemini CLI | `npx @google/gemini-cli@latest --experimental-acp` |
| Qwen Code | `npx @qwen-code/qwen-code@latest --acp --experimental-skills` |
| Auggie CLI | `npx @augmentcode/auggie@latest --acp` |
| Qoder CLI | `npx @qoder-ai/qodercli@latest --acp` |
| Codex CLI | `npx @zed-industries/codex-acp@latest` |
| Vibe | `vibe-acp` |
| OpenCode | `npx opencode-ai@latest acp` |
| OpenClaw | `npx openclaw acp` |
| [Kiro CLI](https://kiro.dev/docs/cli/acp/) | `kiro-cli acp` |
| [Hermes Agent](https://hermes-agent.nousresearch.com/docs/user-guide/features/acp) | `hermes acp` |

You can add custom agent configurations in settings.

> **Note on Hermes Agent**: Hermes is a Python package, not an npm package. Install it via the [Hermes Quickstart](https://hermes-agent.nousresearch.com/docs/getting-started/quickstart) (Linux/macOS/WSL2 only — Windows requires [WSL2](https://learn.microsoft.com/en-us/windows/wsl/install)). Make sure `hermes` is on your `PATH` and launch VS Code from the same shell/venv. Configure credentials with `hermes model`.

> **Note on Vibe Agent**: Vibe must be installed separately and `vibe-acp` must be available on `PATH`.

## Extension Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `acp.agents` | *(12 agents)* | Agent configurations. Each key is the agent name, value has `command`, `args`, and `env`. |
| `acp.autoApprovePermissions` | `ask` | How agent permission requests are handled: `ask` or `allowAll`. |
| `acp.defaultWorkingDirectory` | `""` | Default working directory for agent sessions. Empty uses current workspace. |
| `acp.logTraffic` | `true` | Log all ACP protocol traffic to the ACP Traffic output channel. |
| `acp.pipeline.enabled` | `true` | Enable virtual pipeline agents loaded from `.acp/pipelines/*.yaml`. |

## Pipeline Workflow

When `acp.pipeline.enabled` is true, the Agents view includes one virtual agent for each valid workspace pipeline in `.acp/pipelines/*.yaml`.

1. Connect to a pipeline virtual agent.
2. Send a normal prompt.
3. LangGraph runs the YAML workflow until an approval step.
4. Review or edit the plan in the chat.
5. Approve the plan to resume the graph, or reject to stop it.
6. Later steps call their configured ACP agents, including any workspace-changing step.

Pipeline YAML supports agent steps, approval steps, and read-only parallel branches. See [docs/pipeline-a2a.md](docs/pipeline-a2a.md) for the v2 DSL, failure modes, and troubleshooting. French documentation is available in [doc_fr/pipelines-langgraph.md](doc_fr/pipelines-langgraph.md).

## Commands

Main commands are available from the Command Palette, view title buttons, or context menus:

| Command | Description |
|---------|-------------|
| `ACP: Connect to Agent` | Connect to an agent |
| `ACP: Connect With Current Context` | Connect to an agent and pass current session context to the next prompt. |
| `ACP: Open Session With Current Context` | Open or resume a session with current context prepared for the next prompt. |
| `ACP: New Conversation` | Start a new conversation with the connected agent |
| `ACP: Send Prompt` | Send a message to the agent |
| `ACP: Cancel Current Turn` | Cancel the current agent turn |
| `ACP: Disconnect Agent` | Disconnect from the current agent |
| `ACP: Restart Agent` | Restart the current agent process |
| `ACP: Open Chat Panel` | Focus the chat webview |
| `ACP: Add Agent Configuration` | Add a new agent to settings |
| `ACP: Remove Agent` | Remove an agent configuration |
| `ACP: Set Agent Mode` | Change the agent's operating mode |
| `ACP: Set Agent Model` | Change the agent's model |
| `ACP: Enable Editor Context Link` | Enable automatic editor context injection from the chat view. |
| `ACP: Disable Editor Context Link` | Disable automatic editor context injection. |
| `ACP: Refresh Sessions` | Re-fetch the session list for an agent (also on the agent's right-click menu) |
| `ACP: Show Log` | Open the ACP Client log output channel |
| `ACP: Show Protocol Traffic` | Open the ACP Traffic output channel |
| `ACP: Open Debug Snapshot` | Open the structured debug trace snapshot panel. |
| `ACP: Browse Agent Registry` | Browse the ACP agent registry |

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+Shift+A` (`Cmd+Shift+A` on Mac) | Open Chat Panel |
| `Escape` (when turn in progress) | Cancel Current Turn |

## Development

### Prerequisites

- Node.js 18+
- VS Code 1.85+

### Setup

```bash
git clone https://github.com/maurice30120/vscode-acp.git
cd vscode-acp
npm install
```

### Build & Run

```bash
npm run compile    # One-time build
npm run watch      # Watch mode for development
```

Press `F5` in VS Code to launch the Extension Development Host.

### Testing

```bash
npm run pretest    # Compile tests + lint
npm test           # Run tests
```

### Packaging

```bash
npm run package    # Production build
npx @vscode/vsce package   # Create .vsix
```

## Architecture

The extension follows a modular architecture:

- **Core**: `AgentManager`, `ConnectionManager`, `SessionManager`, `AcpClientImpl`, `WorkspaceIdentity`, `SessionHistoryStore`, `DebugTraceStore`
- **Handlers**: `FileSystemHandler`, `TerminalHandler`, `PermissionHandler`, `SessionUpdateHandler`
- **UI**: `SessionTreeProvider`, `ChatWebviewProvider`, `StatusBarManager`, `EditorContext`, `DebugWebviewPanel`
- **Config**: `AgentConfig`, `RegistryClient`, `PipelineConfig`
- **Pipeline**: `PipelineService`, `PipelineGraphCompiler`, `AcpAgentRunner`, `ProposedPlan`
- **Utils**: `Logger`

Communication with agents uses the ACP protocol (JSON-RPC 2.0 over stdio).

## Known Issues

- Agents must be available via the system PATH or `npx`
- Some agents may require additional authentication setup
- Pipeline virtual agents require both planner and implementer agents to be configured in `acp.agents`

## Links

- [ACP Client on Visual Studio Code Marketplace](https://marketplace.visualstudio.com/items?itemName=damien-huyet.acp-client)
- [Agent Client Protocol](https://agentclientprotocol.com/)
- [GitHub Repository](https://github.com/maurice30120/vscode-acp)

## License

MIT — see [LICENSE](LICENSE) for details.
