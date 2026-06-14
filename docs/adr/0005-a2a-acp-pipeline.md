# ADR-0005: A2A Planning Pipelines for Vibe Implementation

**Status**: Accepted

## Context
The extension can already connect to ACP-compatible coding agents, but each chat session usually targets one configured ACP agent directly. The pipeline workflow adds a reviewable planning step before implementation.

There are now two planner variants that share the same implementation stage:

1. `Codex Plan -> Vibe Implement`, where `Codex CLI` produces the plan.
2. `Gemini Plan -> Vibe Implement`, where `Gemini CLI` produces the plan.

Both pipelines use `Vibe` as the default implementer. The user must be able to review and edit the plan before implementation starts. Internal planner and implementer sessions must not appear as normal ACP sessions in the tree, and the existing ACP permission policy must continue to govern filesystem and terminal actions.

## Decision
Expose two synthetic pipeline agents that route prompts through the same local A2A/ACP orchestration:

- Expose the Codex pipeline with:
  - `acp.pipeline.enabled`
  - `acp.pipeline.virtualAgentName`
  - `acp.pipeline.plannerAgentName`
  - `acp.pipeline.implementerAgentName`
- Expose the Gemini pipeline with:
  - `acp.pipeline.geminiVirtualAgentName`
  - `acp.pipeline.geminiPlannerAgentName`
  - `acp.pipeline.geminiImplementerAgentName`
- Use `acp.pipeline.enabled` as the shared feature toggle for both synthetic pipeline agents.
- Keep normal ACP agents unchanged and do not create visible proxy ACP agents for the internal planner or implementer.
- Start local JSON-RPC A2A servers for the planner and implementer through `@a2a-js/sdk` and `express`.
- Back each A2A executor with an isolated ACP run that:
  - launches the configured ACP agent process,
  - opens an ACP session,
  - sends the generated prompt,
  - collects `agent_message_chunk` output,
  - disposes listeners, connections, and processes after completion or failure.
- Require the planner response to contain exactly one `<proposed_plan>...</proposed_plan>` block.
- Show that block in the webview as an editable plan using `pipelinePlanReady`.
- Wait for `approvePipelinePlan` before calling the implementer.
- Validate the edited plan again before implementation; it must contain exactly one `<proposed_plan>` block and no text outside it.
- Send the approved plan to Vibe through the A2A implementer agent.
- Forward implementer session updates into the active virtual pipeline chat so the user sees implementation progress.
- Reuse the existing ACP permission behavior (`ask` or `allowAll`) for Vibe actions.
- Support plan revision before approval: a second prompt on the same pipeline session sends the previous plan, the new user feedback/request, and the original request back to the planner.
- Resolve the planner and implementer settings from the active synthetic pipeline agent so each pipeline keeps its own configuration.

## Consequences
**Positive**:
- Users get an explicit review gate between planning and implementation for both planner choices.
- The tree remains simple because only the two synthetic pipeline agents are visible, not their internal ACP sessions.
- Each pipeline remains configurable through normal VS Code settings.
- A2A is used as the contract between planner and implementer roles instead of direct in-process coupling.
- ACP integration stays centralized and works with agents already configured by the extension.
- Vibe cannot mutate the workspace until the user approves the plan.
- Plan revisions are handled without starting over, while preserving the original request as context.

**Negative**:
- The feature adds two local HTTP servers during pipeline execution.
- Each pipeline depends on its configured planner and implementer ACP agents being available.
- The Gemini pipeline adds a second visible virtual agent and more settings to keep aligned.
- Planner output must satisfy a strict XML-like block format, which can fail and require retrying.
- The webview now has an additional interactive message type for editable plans.

## Alternatives Considered
- Call planners and Vibe directly from `PipelineService` without A2A - rejected because the feature explicitly needs A2A as the communication boundary between agents.
- Expose planners and implementers as normal ACP agents in the tree - rejected because internal pipeline sessions would clutter the user-facing agent list.
- Create separate `PipelineService` implementations for Codex and Gemini - rejected because the orchestration, plan validation, approval UI, and Vibe handoff are identical.
- Let Vibe run immediately after a planner produces a plan - rejected because it removes the required human approval gate.
- Accept any Markdown plan from planners - rejected because strict `<proposed_plan>` extraction makes the handoff deterministic and testable.
- Add a public REST or gRPC endpoint for the pipeline - deferred because the first increment only needs local in-extension orchestration.
