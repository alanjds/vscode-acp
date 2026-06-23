import type { PipelineDefinition, PipelinePrimitiveDefinition } from '../config/PipelineCatalog';
import { validatePipelineDefinition } from '../config/PipelineCatalog';
import type { AgentTeamDefinition, TeamRoleId } from '../config/AgentTeamConfig';

export interface CompiledTeamMetadata {
  sourceKind: 'team';
  sourceFilePath: string;
  teamId: string;
  roleByStepId: Record<string, TeamRoleId>;
  agentByRole: Record<TeamRoleId, string>;
  instructionsByRole: Partial<Record<TeamRoleId, string>>;
}

export interface TeamCompileResult {
  pipeline?: PipelineDefinition;
  errors: string[];
}

const ROLE_STEP_ORDER: TeamRoleId[] = ['planner', 'implementer', 'reviewer', 'tester'];

function buildPlannerPrompt(instructions: string): string {
  return [
    instructions.trim(),
    '',
    'User request:',
    '{{userPrompt}}',
    '',
    'Return exactly one <proposed_plan>...</proposed_plan> block with a decision-complete implementation plan.',
  ].join('\n');
}

function buildImplementerPrompt(instructions: string): string {
  return [
    instructions.trim(),
    '',
    'Original request:',
    '{{userPrompt}}',
    '',
    'Approved plan:',
    '{{steps.approval.output}}',
  ].join('\n');
}

function buildReviewerPrompt(instructions: string): string {
  return [
    instructions.trim(),
    '',
    'Original request:',
    '{{userPrompt}}',
    '',
    'Approved plan:',
    '{{steps.approval.output}}',
    '',
    'Implementation output:',
    '{{steps.implementer.output}}',
  ].join('\n');
}

function buildTesterPrompt(instructions: string): string {
  return [
    instructions.trim(),
    '',
    'Original request:',
    '{{userPrompt}}',
    '',
    'Approved plan:',
    '{{steps.approval.output}}',
    '',
    'Implementation output:',
    '{{steps.implementer.output}}',
    '',
    'Review output:',
    '{{steps.reviewer.output}}',
  ].join('\n');
}

function buildPrimitive(roleId: TeamRoleId, instructions: string): PipelinePrimitiveDefinition {
  switch (roleId) {
    case 'planner':
      return {
        agent: '',
        output: 'proposed_plan',
        sideEffects: 'none',
        prompt: buildPlannerPrompt(instructions),
      };
    case 'implementer':
      return {
        agent: '',
        output: 'markdown',
        sideEffects: 'workspace',
        prompt: buildImplementerPrompt(instructions),
      };
    case 'reviewer':
      return {
        agent: '',
        output: 'markdown',
        sideEffects: 'none',
        prompt: buildReviewerPrompt(instructions),
      };
    case 'tester':
      return {
        agent: '',
        output: 'markdown',
        sideEffects: 'none',
        prompt: buildTesterPrompt(instructions),
      };
  }
}

export function compileTeamToPipeline(
  team: AgentTeamDefinition,
  resolvedInstructions: Partial<Record<TeamRoleId, string>>,
  sourceFilePath: string,
  agentConfigs: Record<string, unknown>,
): TeamCompileResult {
  const activeRoles = ROLE_STEP_ORDER.filter(roleId => team.roles[roleId] !== undefined);
  const primitives: Record<string, PipelinePrimitiveDefinition> = {};
  const roleByStepId: Record<string, TeamRoleId> = {};
  const agentByRole: Record<TeamRoleId, string> = {} as Record<TeamRoleId, string>;

  for (const roleId of activeRoles) {
    const role = team.roles[roleId]!;
    const instructions = resolvedInstructions[roleId];
    if (!instructions) {
      return { errors: [`Missing resolved instructions for role "${roleId}".`] };
    }
    const primitive = buildPrimitive(roleId, instructions);
    primitive.agent = role.agent;
    primitives[roleId] = primitive;
    roleByStepId[roleId] = roleId;
    agentByRole[roleId] = role.agent;
  }

  const steps: PipelineDefinition['steps'] = [
    { id: 'planner', use: 'planner' },
    { id: 'approval', type: 'approval', input: '{{steps.planner.output}}' },
    { id: 'implementer', use: 'implementer' },
    { id: 'reviewer', use: 'reviewer' },
  ];

  if (team.roles.tester) {
    steps.push({ id: 'tester', use: 'tester' });
  }

  const metadata: CompiledTeamMetadata = {
    sourceKind: 'team',
    sourceFilePath,
    teamId: team.id,
    roleByStepId,
    agentByRole,
    instructionsByRole: { ...resolvedInstructions },
  };

  const pipeline: PipelineDefinition = {
    version: 2,
    id: `team-${team.id}`,
    title: team.title,
    primitives,
    steps,
    metadata,
  };

  const validation = validatePipelineDefinition(
    {
      version: pipeline.version,
      id: pipeline.id,
      title: pipeline.title,
      primitives: pipeline.primitives,
      steps: pipeline.steps,
    },
    sourceFilePath,
    agentConfigs,
  );

  if (validation.errors.length > 0) {
    return {
      errors: validation.errors.map(error => `Compiled pipeline validation: ${error}`),
    };
  }

  return {
    pipeline: {
      ...validation.definition!,
      metadata,
    },
    errors: [],
  };
}

export function serializeCompiledTeamPipeline(pipeline: PipelineDefinition): string {
  const { metadata, ...rest } = pipeline;
  return JSON.stringify({ ...rest, metadata }, null, 2);
}

export interface ReviewerRerunPromptInput {
  reviewerInstructions: string;
  approvedPlan: string;
  implementOutput: string;
  workspaceDiff: string;
}

export function buildReviewerRerunPrompt(input: ReviewerRerunPromptInput): string {
  return [
    input.reviewerInstructions.trim(),
    '',
    'Original request:',
    '(see archived team run)',
    '',
    'Approved plan:',
    input.approvedPlan,
    '',
    'Implementation output:',
    input.implementOutput,
    '',
    'Current workspace diff (git diff HEAD):',
    input.workspaceDiff || '(no diff detected)',
  ].join('\n');
}
