# Pipeline A2A Workflow

ACP Client includes optional virtual agents that split a task into two phases:

1. A planner ACP agent produces a single `<proposed_plan>` block.
2. The user reviews, edits, approves, or rejects the plan.
3. An implementer ACP agent receives the approved plan and performs the workspace changes.

The virtual agent is exposed in the same Agents view as normal ACP agents, but internally it starts local A2A JSON-RPC servers on `127.0.0.1` and bridges each A2A request to the configured ACP agents.

## Available Virtual Agents

Two pipeline presets are available when `acp.pipeline.enabled` is true:

| Virtual agent | Planner | Implementer |
|---------------|---------|-------------|
| `Codex Plan -> Vibe Implement` | `Codex CLI` | `Vibe` |
| `Gemini Plan -> Vibe Implement` | `Gemini CLI` | `Vibe` |

The display names and backing agents are configurable with `acp.pipeline.*` settings.

## Settings

| Setting | Default | Purpose |
|---------|---------|---------|
| `acp.pipeline.enabled` | `true` | Shows or hides pipeline virtual agents. |
| `acp.pipeline.virtualAgentName` | `Codex Plan -> Vibe Implement` | Display name for the Codex-backed pipeline. |
| `acp.pipeline.plannerAgentName` | `Codex CLI` | ACP agent used for planning in the Codex-backed pipeline. |
| `acp.pipeline.implementerAgentName` | `Vibe` | ACP agent used for implementation in the Codex-backed pipeline. |
| `acp.pipeline.geminiVirtualAgentName` | `Gemini Plan -> Vibe Implement` | Display name for the Gemini-backed pipeline. |
| `acp.pipeline.geminiPlannerAgentName` | `Gemini CLI` | ACP agent used for planning in the Gemini-backed pipeline. |
| `acp.pipeline.geminiImplementerAgentName` | `Vibe` | ACP agent used for implementation in the Gemini-backed pipeline. |

Each configured planner or implementer name must exist in `acp.agents`. The pipeline does not install agents automatically.

## User Flow

1. Open the ACP Client activity bar view.
2. Connect to one of the pipeline virtual agents.
3. Send the task as a normal chat prompt.
4. Wait for the proposed plan to appear.
5. Edit the plan if needed.
6. Click approve to start implementation, or reject to stop the run.
7. Watch implementation output in the chat and inspect ACP logs if a failure occurs.

## Failure Modes

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| `Missing configured ACP pipeline agent(s)` | The planner or implementer name does not exist in `acp.agents`. | Update `acp.pipeline.*` or add the missing agent configuration. |
| Planner never returns a plan | The planner did not emit exactly one `<proposed_plan>` block. | Retry with a clearer request or inspect the planner agent logs. |
| Implementation fails immediately | The implementer agent cannot start, authenticate, or initialize ACP. | Check PATH, credentials, and ACP Client logs. |
| Pipeline cancelled | The active turn was cancelled or the virtual session was disconnected. | Reconnect to the virtual agent and start a new request. |
| Local A2A server startup fails | Port binding or local networking is blocked. | Ensure `127.0.0.1` loopback connections are allowed. |

## Notes

- The planner is instructed not to mutate the workspace.
- The implementer receives the original prompt plus the approved plan.
- Existing ACP permission handling still applies to filesystem and terminal actions.
- The pipeline is single-session from the chat perspective; planner and implementer runs are implementation details.
