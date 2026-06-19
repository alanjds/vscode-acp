# ADR-0012: Agent Teams - Declarative Role-Based Workflows

**Status**: Accepted

## Context

Users want a simple way to create multi-agent workflows following the common "plan-implement-review" pattern without writing complex pipeline v2 YAML. The existing pipeline v2 DSL provides full control but requires understanding of primitives, steps, approval gates, and template variables. This creates a barrier for users who want standard workflows with different agents for each role.

Inspiration from tools like Omnigent's Polly showed that users respond well to role-based abstractions (planner, implementer, reviewer) that hide orchestration complexity. The ACP Client extension already had a working pipeline v2 engine with LangGraph orchestration, approval gates, and sandbox support.

Key user needs identified:
- Quick setup for standard plan-implement-review workflows
- Different agents for different phases (e.g., one model for planning, another for coding)
- Reusable role definitions across a workspace
- Clear separation between planning and workspace-changing steps
- Integration with existing sandbox and approval infrastructure

## Decision

1. **Add Agent Teams as a declarative layer** on top of pipeline v2, not as a separate orchestration engine.
   - Teams define roles (`planner`, `implementer`, `reviewer`, `tester`) with agent assignments and instruction files
   - Teams compile to pipeline v2 JSON at runtime via `AgentTeamCompiler`
   - All pipeline v2 features (approval, sandbox, validation) are inherited automatically

2. **Fixed role set in v1**:
   - Required roles: `planner`, `implementer`, `reviewer`
   - Optional role: `tester`
   - Fixed execution order: planner → approval → implementer → reviewer → tester

3. **File format and location**:
   - Team definitions in `.acp/teams/*.yaml` (or `.yml`)
   - YAML schema with `version: 1`, `id`, `title`, `roles`
   - External instruction files referenced by path (resolved relative to workspace root)
   - `orchestrator.agent` field as metadata only (does not execute as an LLM)

4. **Compilation behavior**:
   - Each role compiles to a pipeline v2 primitive with generated prompts
   - Planner: `output: proposed_plan`, `sideEffects: none`
   - Implementer: `output: markdown`, `sideEffects: workspace`
   - Reviewer: `output: markdown`, `sideEffects: none`
   - Tester: `output: markdown`, `sideEffects: none`
   - Approval step automatically inserted between planner and implementer

5. **Integration with existing infrastructure**:
   - Teams loaded by `AgentTeamCatalog` alongside pipeline files
   - Teams appear as virtual agents in the Agents tree via `PipelineService`
   - Sandbox automatically applied to implementer when `acp.sandbox.enabled` is true
   - Instruction file size limited by `acp.instructions.maxBytes` setting

6. **Validation rules**:
   - All referenced agents must exist in `acp.agents`
   - All instruction file paths must be resolvable and within workspace
   - Forbidden fields (`sideEffects`, `output`, `prompt`) rejected in team YAML
   - Team IDs must not conflict with pipeline IDs

7. **Dedicated commands**:
   - `ACP: Show Compiled Team Pipeline` — inspect generated pipeline v2 JSON
   - `ACP: Re-run Team Reviewer` — re-run reviewer on latest team run + current git diff

## Consequences

### Positive

- **Lower barrier to entry**: Users can create multi-agent workflows with minimal YAML
- **Consistency**: Teams inherit all pipeline v2 safety features (approval gates, sandbox, validation)
- **Reusability**: Instruction files can be shared across teams and pipelines
- **Maintainability**: Single orchestration engine (pipeline v2) to maintain
- **Upgrade path**: Teams can be "unfolded" into raw pipeline v2 if customization needed
- **No breaking changes**: Existing pipelines unaffected; teams are additive

### Negative

- **Limited flexibility in v1**: Fixed role order, no parallel roles, no custom roles
- **Metadata confusion**: `orchestrator.agent` field might suggest active orchestration (it does not)
- **Discovery**: Teams as a separate concept might confuse users familiar with pipelines only
- **Naming**: "Agent Teams" vs "Équipes d'agents" requires maintaining dual terminology

### Neutral

- **Compilation overhead**: Teams add a compilation step, but runtime performance is identical to pipeline v2
- **Abstraction leak**: Users might need to understand pipeline v2 for debugging (hence the `Show Compiled Team Pipeline` command)

## Alternatives considered

### Alternative 1: New Orchestration Engine

**Proposal**: Create a separate orchestration engine specifically for agent teams with its own state machine.

**Rejected because**:
- Duplicates existing pipeline v2 functionality
- Creates two orchestration systems to maintain
- Loses integration with existing approval and sandbox infrastructure
- Would need to re-implement all the safety checks and validation

**Kept from this approach**: The role-based concept and user-facing abstraction.

### Alternative 2: Extend Pipeline v2 DSL

**Proposal**: Add team-like syntax directly into pipeline v2 DSL (e.g., a `roles:` section alongside `primitives:`).

**Rejected because**:
- Complicates the pipeline v2 schema
- Mixes two levels of abstraction in one file
- Loses the simplicity of having separate, focused team definitions
- Would still need a compilation step internally

**Kept from this approach**: The idea of external instruction files.

### Alternative 3: Agent Profiles First

**Proposal**: First implement agent profiles (`.acp/agents/*.yaml`), then build teams on top of profiles.

**Partially adopted**:
- Teams do reference agents by name from `acp.agents` settings
- Instruction files serve a similar purpose to agent profiles for prompts
- However, full agent profiles (with model, mode, permissions) remain a separate feature
- Teams v1 focuses on the role orchestration pattern specifically

### Alternative 4: JSON Format

**Proposal**: Use JSON instead of YAML for team definitions.

**Rejected because**:
- YAML is more readable for configuration files
- Already established pattern in the codebase (pipeline v2 uses YAML)
- YAML supports comments (useful for documentation)
- Existing YAML loader infrastructure can be reused

### Alternative 5: Implicit Orchestrator

**Proposal**: Make the orchestrator an active LLM that dynamically coordinates between roles.

**Rejected for v1 because**:
- Adds significant complexity
- Requires defining orchestrator prompts and capabilities
- Harder to reason about and debug
- Current approach (static compilation) is simpler and more predictable
- Can be added in a future version without breaking existing teams

**Kept for future**: The `orchestrator.agent` field is reserved for potential future use.

## Future Considerations

- **Custom roles**: Allow users to define additional role types beyond the v1 set
- **Parallel roles**: Support parallel execution of multiple implementers or testers (requires relaxing pipeline v2 parallel restrictions)
- **Active orchestrator**: Make `orchestrator.agent` an actual LLM that coordinates and can dynamically adjust the workflow
- **Team composition**: Allow teams to reference other teams (nesting)
- **Role conditions**: Add conditional execution of roles based on previous outputs
- **Profile integration**: Fully integrate with a future agent profiles system

## Related ADRs

- [ADR-0005: A2A ACP Pipeline](0005-a2a-acp-pipeline.md) — Original pipeline v2 design
- [ADR-0011: Agent Sandbox via Git Worktree](0011-agent-sandbox-worktree.md) — Sandbox integration used by teams
