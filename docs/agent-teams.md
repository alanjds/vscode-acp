# Agent Teams

Agent teams let you declare a multi-role workflow in `.acp/teams/*.yaml` instead of writing a pipeline v2 file by hand.

## Format (v1)

```yaml
version: 1
id: feature-team
title: Feature Team
orchestrator:
  agent: Codex CLI   # metadata only in v1
roles:
  planner:
    agent: Codex CLI
    instructions: .acp/agents/planner.md
  implementer:
    agent: Vibe
    instructions: .acp/agents/implementer.md
  reviewer:
    agent: Claude Code
    instructions: .acp/agents/reviewer.md
  tester:            # optional
    agent: Codex CLI
    instructions: .acp/agents/tester.md
```

## Execution model

Teams compile to the existing pipeline engine:

1. `planner` → `approval` → `implementer` → `reviewer` → optional `tester`
2. Only `implementer` may change the workspace (`sideEffects: workspace`)
3. Sandbox mode applies automatically to `implementer` when `acp.sandbox.enabled` is true

## UI

- Teams appear in the Agents tree with an organization icon
- Chat shows a role timeline and isolated role output sections
- Invalid team YAML appears as `Team Title (invalid)` with the validation error in the tooltip

## Commands

- `ACP: Show Compiled Team Pipeline` — inspect the generated pipeline v2 JSON
- `ACP: Re-run Team Reviewer` — run reviewer only on the latest completed team run and current git diff

## Limits (v1)

- Required roles: `planner`, `implementer`, `reviewer`
- No custom roles, parallel implementers, or active orchestrator LLM
- Team titles must not conflict with `.acp/pipelines/*.yaml` titles

See also: [pipeline-a2a.md](./pipeline-a2a.md)
