# Pipeline LangGraph Workflow

ACP Client exposes optional virtual agents from workspace pipeline files in `.acp/pipelines/*.yaml` and from Agent Team definitions in `.acp/teams/*.yaml`.

Each pipeline is compiled into a local LangGraph graph. Graph nodes call configured ACP agents, approval steps pause execution for human review, and approved runs resume from the same VS Code pipeline session.

> **Note**: Agent Teams provide a declarative way to define role-based workflows (planner, implementer, reviewer, tester) that compile to pipeline v2. See [agent-teams.md](./agent-teams.md) for the team format.

## Settings

| Setting | Default | Purpose |
|---------|---------|---------|
| `acp.pipeline.enabled` | `true` | Shows or hides workspace-defined pipeline virtual agents from `.acp/pipelines/*.yaml` and agent teams from `.acp/teams/*.yaml`. |

Every `primitives.*.agent` value in a pipeline file must exist in `acp.agents`. For Agent Teams, every `roles.<role>.agent` value must exist in `acp.agents`. The pipeline system does not install agents automatically.

## DSL v2

```yaml
version: 2
id: plan-execute-verify
title: Plan Execute Verify

primitives:
  planner:
    agent: Codex CLI
    output: proposed_plan
    sideEffects: none
    prompt: |
      Create a decision-complete implementation plan only.
      Return exactly one <proposed_plan> block.

      User request:
      {{userPrompt}}

  implementer:
    agent: Vibe
    output: markdown
    sideEffects: workspace
    prompt: |
      Implement the approved plan in the current workspace.

      Approved plan:
      {{steps.approval.output}}

steps:
  - id: plan
    use: planner

  - id: approval
    type: approval
    input: "{{steps.plan.output}}"

  - id: implement
    use: implementer
```

Supported step types:

- Agent step: `id` plus `use`, where `use` references a primitive.
- Approval step: `id`, `type: approval`, and `input`.
- Parallel step: `id`, `type: parallel`, and at least two read-only branches.

Supported template variables:

- `{{userPrompt}}`
- `{{steps.<stepId>.output}}`
- `{{steps.<parallelStepId>.branches.<branchId>.output}}`

## Safety Rules

- `version` must be `2`; legacy v1 pipelines are rejected.
- `sideEffects: workspace` is rejected before an approval step.
- `sideEffects: workspace` is rejected inside `type: parallel`.
- `output: proposed_plan` must contain exactly one `<proposed_plan>...</proposed_plan>` block.
- Approved plans must contain only one `<proposed_plan>` block and no text outside it.

## User Flow

1. Add or edit a pipeline file in `.acp/pipelines`.
2. Ensure referenced agents exist in `acp.agents`.
3. Open the ACP Client activity bar view.
4. Connect to the pipeline virtual agent.
5. Send the task as a normal chat prompt.
6. Review, edit, approve, or reject the proposed plan.
7. Watch later ACP agent output in the same pipeline chat.

## Failure Modes

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| `Missing configured ACP pipeline agent(s)` | A primitive references an agent not present in `acp.agents`. | Update the YAML or add the missing agent configuration. |
| Pipeline virtual agent is missing | The pipeline is invalid, `acp.pipeline.enabled` is false, or the file is outside `.acp/pipelines`. | Check ACP logs and YAML validation errors. |
| Planner never returns a plan | A `proposed_plan` primitive did not emit exactly one plan block. | Retry with a clearer request or inspect the agent logs. |
| Implementation fails immediately | The workspace-changing agent cannot start, authenticate, or initialize ACP. | Check PATH, credentials, and ACP Client logs. |
| Pipeline cancelled | The active turn was cancelled or the virtual session was disconnected. | Reconnect to the virtual agent and start a new request. |

## Agent Teams

For role-oriented workflows, use `.acp/teams/*.yaml` instead of hand-written pipeline YAML. Teams compile to pipeline v2 at runtime and appear as virtual agents in the Agents tree.

See [agent-teams.md](./agent-teams.md) for the v1 schema, commands, and limits.

## Notes

- LangGraph owns orchestration and approval resume state.
- ACP remains the communication protocol for all agent calls.
- Existing ACP permission handling still applies to filesystem and terminal actions.
- The pipeline is single-session from the chat perspective; internal agent runs are implementation details.
