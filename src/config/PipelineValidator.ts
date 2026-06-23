import type {
  PipelineParallelBranchDefinition,
  PipelinePrimitiveDefinition,
  PipelineStepDefinition,
  PipelineValidationResult,
} from './PipelineCatalog';

const TEMPLATE_RE = /{{\s*([^}]+?)\s*}}/g;
const STEP_OUTPUT_RE = /^steps\.([A-Za-z0-9_-]+)\.output$/;
const BRANCH_OUTPUT_RE = /^steps\.([A-Za-z0-9_-]+)\.branches\.([A-Za-z0-9_-]+)\.output$/;

type RawRecord = Record<string, unknown>;

export function validatePipelineDefinition(
  value: unknown,
  filePath: string,
  agentConfigs: Record<string, unknown>,
): PipelineValidationResult {
  const errors: string[] = [];
  if (!isRecord(value)) {
    return { errors: ['Pipeline YAML must be an object.'] };
  }

  if (value.version !== 2) {
    errors.push('version must be 2.');
  }

  const id = readRequiredString(value, 'id', errors);
  const title = readRequiredString(value, 'title', errors);
  const primitivesValue = value.primitives;
  const stepsValue = value.steps;
  const primitives: Record<string, PipelinePrimitiveDefinition> = {};

  if (!isRecord(primitivesValue)) {
    errors.push('primitives must be an object.');
  } else {
    for (const [primitiveId, primitiveValue] of Object.entries(primitivesValue)) {
      if (!isRecord(primitiveValue)) {
        errors.push(`primitive "${primitiveId}" must be an object.`);
        continue;
      }
      const agent = readRequiredString(primitiveValue, 'agent', errors, `primitive "${primitiveId}"`);
      const prompt = readRequiredString(primitiveValue, 'prompt', errors, `primitive "${primitiveId}"`);
      const output = primitiveValue.output;
      const sideEffects = primitiveValue.sideEffects ?? 'none';

      if (output !== 'markdown' && output !== 'proposed_plan') {
        errors.push(`primitive "${primitiveId}" output must be "markdown" or "proposed_plan".`);
      }
      if (sideEffects !== 'none' && sideEffects !== 'workspace') {
        errors.push(`primitive "${primitiveId}" sideEffects must be "none" or "workspace".`);
      }
      if (agent && !agentConfigs[agent]) {
        errors.push(`primitive "${primitiveId}" references missing ACP agent "${agent}".`);
      }
      if (agent && prompt && (output === 'markdown' || output === 'proposed_plan')
        && (sideEffects === 'none' || sideEffects === 'workspace')) {
        primitives[primitiveId] = {
          agent,
          prompt,
          output,
          sideEffects,
        };
      }
    }
  }

  const steps = readSteps(stepsValue, primitives, errors);
  validateStepSafetyAndTemplates(steps, primitives, errors);
  validatePrimitiveTemplateSyntax(primitives, errors);

  if (errors.length > 0 || !id || !title) {
    return { errors };
  }

  return {
    definition: {
      version: 2,
      id,
      title,
      primitives,
      steps,
      source: 'workspace',
      filePath,
    },
    errors: [],
  };
}

export function extractTemplateVariables(template: string): string[] {
  const variables: string[] = [];
  for (const match of template.matchAll(TEMPLATE_RE)) {
    variables.push(match[1].trim());
  }
  return variables;
}

function readSteps(
  stepsValue: unknown,
  primitives: Record<string, PipelinePrimitiveDefinition>,
  errors: string[],
): PipelineStepDefinition[] {
  const steps: PipelineStepDefinition[] = [];
  const seenStepIds = new Set<string>();
  if (!Array.isArray(stepsValue)) {
    errors.push('steps must be an array.');
    return steps;
  }

  for (const [index, stepValue] of stepsValue.entries()) {
    if (!isRecord(stepValue)) {
      errors.push(`step ${index + 1} must be an object.`);
      continue;
    }
    const stepLabel = `step ${index + 1}`;
    const stepId = readRequiredString(stepValue, 'id', errors, stepLabel);
    if (stepId && seenStepIds.has(stepId)) {
      errors.push(`step id "${stepId}" is duplicated.`);
    }
    if (stepId) {
      seenStepIds.add(stepId);
    }

    const use = stepValue.use;
    const type = stepValue.type;
    if (typeof use === 'string') {
      if (type !== undefined) {
        errors.push(`step "${stepId || index + 1}" cannot have both use and type.`);
      }
      if (!primitives[use]) {
        errors.push(`step "${stepId || index + 1}" references unknown primitive "${use}".`);
      }
      if (stepId) {
        steps.push({ id: stepId, use });
      }
      continue;
    }

    if (type === 'approval') {
      const input = readRequiredString(stepValue, 'input', errors, `approval step "${stepId || index + 1}"`);
      if (stepId && input) {
        steps.push({ id: stepId, type: 'approval', input });
      }
      continue;
    }

    if (type === 'parallel') {
      const branches = readParallelBranches(stepValue.branches, stepId || String(index + 1), primitives, errors);
      if (stepId && branches.length > 0) {
        steps.push({ id: stepId, type: 'parallel', branches });
      }
      continue;
    }

    errors.push(`step "${stepId || index + 1}" must define use, type: approval, or type: parallel.`);
  }

  return steps;
}

function readParallelBranches(
  branchesValue: unknown,
  stepId: string,
  primitives: Record<string, PipelinePrimitiveDefinition>,
  errors: string[],
): PipelineParallelBranchDefinition[] {
  if (!Array.isArray(branchesValue)) {
    errors.push(`parallel step "${stepId}" branches must be an array.`);
    return [];
  }
  if (branchesValue.length < 2) {
    errors.push(`parallel step "${stepId}" must have at least two branches.`);
  }

  const branches: PipelineParallelBranchDefinition[] = [];
  const seenBranchIds = new Set<string>();
  for (const [index, branchValue] of branchesValue.entries()) {
    if (!isRecord(branchValue)) {
      errors.push(`parallel step "${stepId}" branch ${index + 1} must be an object.`);
      continue;
    }
    const branchId = readRequiredString(branchValue, 'id', errors, `parallel step "${stepId}" branch ${index + 1}`);
    const use = readRequiredString(branchValue, 'use', errors, `parallel step "${stepId}" branch "${branchId || index + 1}"`);
    if (branchId && seenBranchIds.has(branchId)) {
      errors.push(`parallel step "${stepId}" branch id "${branchId}" is duplicated.`);
    }
    if (branchId) {
      seenBranchIds.add(branchId);
    }
    if (use && !primitives[use]) {
      errors.push(`parallel step "${stepId}" branch "${branchId || index + 1}" references unknown primitive "${use}".`);
    }
    if (use && primitives[use]?.sideEffects === 'workspace') {
      errors.push(`parallel step "${stepId}" branch "${branchId || index + 1}" cannot use workspace side effects.`);
    }
    if (branchId && use) {
      branches.push({ id: branchId, use });
    }
  }
  return branches;
}

function validateStepSafetyAndTemplates(
  steps: PipelineStepDefinition[],
  primitives: Record<string, PipelinePrimitiveDefinition>,
  errors: string[],
): void {
  const previousStepOutputs = new Set<string>();
  const previousBranchOutputs = new Set<string>();
  let approvalSeen = false;

  for (const step of steps) {
    if ('use' in step) {
      const primitive = primitives[step.use];
      if (primitive) {
        if (!approvalSeen && primitive.sideEffects === 'workspace') {
          errors.push(`step "${step.id}" uses workspace side effects before an approval step.`);
        }
        validateTemplateReferences(
          primitive.prompt,
          previousStepOutputs,
          previousBranchOutputs,
          errors,
          `step "${step.id}"`,
        );
      }
      previousStepOutputs.add(step.id);
      continue;
    }

    if (step.type === 'approval') {
      validateTemplateReferences(
        step.input,
        previousStepOutputs,
        previousBranchOutputs,
        errors,
        `approval step "${step.id}"`,
      );
      approvalSeen = true;
      previousStepOutputs.add(step.id);
      continue;
    }

    for (const branch of step.branches) {
      const primitive = primitives[branch.use];
      if (primitive) {
        validateTemplateReferences(
          primitive.prompt,
          previousStepOutputs,
          previousBranchOutputs,
          errors,
          `parallel step "${step.id}" branch "${branch.id}"`,
        );
      }
    }
    for (const branch of step.branches) {
      previousBranchOutputs.add(`${step.id}.${branch.id}`);
    }
  }
}

function validateTemplateReferences(
  template: string,
  previousStepOutputs: Set<string>,
  previousBranchOutputs: Set<string>,
  errors: string[],
  scope: string,
): void {
  for (const variable of extractTemplateVariables(template)) {
    if (variable === 'userPrompt') {
      continue;
    }
    const stepMatch = STEP_OUTPUT_RE.exec(variable);
    if (stepMatch) {
      if (!previousStepOutputs.has(stepMatch[1])) {
        errors.push(`${scope} template variable "{{${variable}}}" must reference a previous step.`);
      }
      continue;
    }
    const branchMatch = BRANCH_OUTPUT_RE.exec(variable);
    if (branchMatch) {
      if (!previousBranchOutputs.has(`${branchMatch[1]}.${branchMatch[2]}`)) {
        errors.push(`${scope} template variable "{{${variable}}}" must reference a previous parallel branch.`);
      }
      continue;
    }
    errors.push(`${scope} template variable "{{${variable}}}" is not supported.`);
  }
}

function validatePrimitiveTemplateSyntax(
  primitives: Record<string, PipelinePrimitiveDefinition>,
  errors: string[],
): void {
  for (const [primitiveId, primitive] of Object.entries(primitives)) {
    for (const variable of extractTemplateVariables(primitive.prompt)) {
      if (variable === 'userPrompt' || STEP_OUTPUT_RE.test(variable) || BRANCH_OUTPUT_RE.test(variable)) {
        continue;
      }
      errors.push(`primitive "${primitiveId}" uses unsupported template variable "{{${variable}}}".`);
    }
  }
}

function readRequiredString(
  record: RawRecord,
  key: string,
  errors: string[],
  scope = 'pipeline',
): string {
  const value = record[key];
  if (typeof value !== 'string' || value.trim().length === 0) {
    errors.push(`${scope} ${key} must be a non-empty string.`);
    return '';
  }
  return value.trim();
}

function isRecord(value: unknown): value is RawRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
