import type { PipelineDefinition } from '../../config/PipelineCatalog';
import type { TeamRoleId } from '../../config/AgentTeamConfig';

export function buildRevisionPrompt(originalUserPrompt: string, currentPlan: string, feedback: string): string {
  return [
    'Original user request:',
    originalUserPrompt,
    '',
    'Current proposed plan:',
    currentPlan,
    '',
    'User revision request:',
    feedback,
    '',
    'Revise the plan based on the user\'s feedback.',
    'Return exactly one <proposed_plan>...</proposed_plan> block.',
  ].join('\n');
}

export function formatPipelineRoleLabel(role: TeamRoleId): string {
  switch (role) {
    case 'planner':
      return 'Planning';
    case 'implementer':
      return 'Implementing';
    case 'reviewer':
      return 'Reviewing';
    case 'tester':
      return 'Testing';
  }
}

export function getPipelineStepPhase(pipeline: PipelineDefinition, stepId: string): import('../PipelineEvents').PipelineStatus {
  if (stepId === 'reviewer') {
    return 'reviewing';
  }
  if (stepId === 'tester') {
    return 'testing';
  }

  let approvalSeen = false;
  for (const step of pipeline.steps) {
    if (step.id === stepId) {
      if (stepId === 'implementer' || (approvalSeen && stepId !== 'planner')) {
        return 'implementing';
      }
      return approvalSeen ? 'implementing' : 'planning';
    }
    if ('type' in step && step.type === 'approval') {
      approvalSeen = true;
    }
  }
  return 'planning';
}

export function findPlannerStepId(pipeline: PipelineDefinition): string {
  for (const step of pipeline.steps) {
    if ('type' in step && step.type === 'approval') {
      break;
    }
    if ('use' in step) {
      const primitive = pipeline.primitives[step.use];
      if (primitive.output === 'proposed_plan') {
        return step.id;
      }
    }
  }
  throw new Error('Pipeline has no planner step with proposed_plan output.');
}
