import type { SessionNotification } from '@agentclientprotocol/sdk';
import {
  Annotation,
  Command,
  END,
  MemorySaver,
  START,
  StateGraph,
  interrupt,
} from '@langchain/langgraph';

import type {
  PipelineDefinition,
  PipelineParallelStepDefinition,
  PipelinePrimitiveDefinition,
  PipelineStepDefinition,
} from '../config/PipelineCatalog';
import { extractSingleProposedPlan } from './ProposedPlan';

export interface PipelineStepOutputValue {
  output?: string;
  branches?: Record<string, { output: string }>;
}

export type PipelineStepOutputs = Record<string, PipelineStepOutputValue>;

export interface PipelineGraphEvent {
  stepId: string;
  branchId?: string;
  status: 'started' | 'completed';
}

export interface PipelineGraphState {
  userPrompt: string;
  stepOutputs: PipelineStepOutputs;
  events: PipelineGraphEvent[];
  approvalRejected: boolean;
  lastOutput: string;
}

export type PipelineExecutorKind = string;

export type AcpRunCallback = (
  kind: PipelineExecutorKind,
  promptText: string,
  onSessionUpdate?: (update: SessionNotification) => void,
) => Promise<string>;

export interface PipelineGraphCompilerHooks {
  onStepStart: (stepId: string, primitive: PipelinePrimitiveDefinition, branchId?: string) => void;
  onStepSessionUpdate: (stepId: string, update: SessionNotification, branchId?: string) => void;
}

export interface CompiledPipelineGraph {
  invoke(
    input: PipelineGraphState | Command,
    config: { configurable: { thread_id: string } },
  ): Promise<PipelineGraphState & { __interrupt__?: Array<{ value: unknown }> }>;
}

const PipelineState = Annotation.Root({
  userPrompt: Annotation<string>(),
  stepOutputs: Annotation<PipelineStepOutputs>({
    reducer: mergeStepOutputs,
    default: () => ({}),
  }),
  events: Annotation<PipelineGraphEvent[]>({
    reducer: (left, right) => left.concat(right),
    default: () => [],
  }),
  approvalRejected: Annotation<boolean>(),
  lastOutput: Annotation<string>(),
});

export class PipelineGraphCompiler {
  constructor(
    private readonly runAcpAgent: AcpRunCallback,
    private readonly hooks: PipelineGraphCompilerHooks,
    private readonly checkpointer: MemorySaver = new MemorySaver(),
  ) {}

  compile(pipeline: PipelineDefinition): CompiledPipelineGraph {
    let graph: any = new StateGraph(PipelineState);
    const stepNodes = pipeline.steps.map(step => this.describeStepNodes(step));

    for (const step of pipeline.steps) {
      if ('use' in step) {
        graph = graph.addNode(step.id, async (state: PipelineGraphState) =>
          this.runAgentStep(pipeline, step.id, step.use, state));
        continue;
      }

      if (step.type === 'approval') {
        graph = graph.addNode(step.id, (state: PipelineGraphState) => {
          const plan = renderTemplate(step.input, state);
          const resume = interrupt<{ stepId: string; plan: string }, { approved: boolean; plan?: string }>({
            stepId: step.id,
            plan,
          });
          if (!resume.approved) {
            return {
              approvalRejected: true,
              events: [{ stepId: step.id, status: 'completed' }],
            };
          }
          const approvedPlan = (resume.plan || '').trim();
          return {
            approvalRejected: false,
            lastOutput: approvedPlan,
            stepOutputs: {
              [step.id]: { output: approvedPlan },
            },
            events: [{ stepId: step.id, status: 'completed' }],
          };
        });
        continue;
      }

      for (const branch of step.branches) {
        const nodeName = getParallelBranchNodeName(step.id, branch.id);
        graph = graph.addNode(nodeName, async (state: PipelineGraphState) =>
          this.runParallelBranch(pipeline, step, branch.id, branch.use, state));
      }
      graph = graph.addNode(getParallelJoinNodeName(step.id), (state: PipelineGraphState) => ({
        lastOutput: renderParallelOutput(step, state),
      }));
    }

    this.addInitialEdges(graph, stepNodes);
    this.addStepEdges(graph, pipeline.steps, stepNodes);

    return graph.compile({ checkpointer: this.checkpointer }) as CompiledPipelineGraph;
  }

  private describeStepNodes(step: PipelineStepDefinition): { entries: string[]; exit: string } {
    if ('use' in step || step.type === 'approval') {
      return { entries: [step.id], exit: step.id };
    }
    return {
      entries: step.branches.map(branch => getParallelBranchNodeName(step.id, branch.id)),
      exit: getParallelJoinNodeName(step.id),
    };
  }

  private addInitialEdges(graph: any, stepNodes: Array<{ entries: string[]; exit: string }>): void {
    const first = stepNodes[0];
    if (!first) {
      graph.addEdge(START, END);
      return;
    }
    for (const entry of first.entries) {
      graph.addEdge(START, entry);
    }
  }

  private addStepEdges(
    graph: any,
    steps: PipelineStepDefinition[],
    stepNodes: Array<{ entries: string[]; exit: string }>,
  ): void {
    for (let index = 0; index < steps.length; index++) {
      const step = steps[index];
      const current = stepNodes[index];
      const next = stepNodes[index + 1];

      if ('type' in step && step.type === 'parallel') {
        graph.addEdge(current.entries, current.exit);
      }

      if (!next) {
        graph.addEdge(current.exit, END);
        continue;
      }

      if ('type' in step && step.type === 'approval') {
        graph.addConditionalEdges(
          current.exit,
          (state: PipelineGraphState) => state.approvalRejected ? END : next.entries,
          [...next.entries, END],
        );
        continue;
      }

      for (const entry of next.entries) {
        graph.addEdge(current.exit, entry);
      }
    }
  }

  private async runAgentStep(
    pipeline: PipelineDefinition,
    stepId: string,
    primitiveId: string,
    state: PipelineGraphState,
  ): Promise<Partial<PipelineGraphState>> {
    const primitive = pipeline.primitives[primitiveId];
    this.hooks.onStepStart(stepId, primitive);
    const prompt = renderTemplate(primitive.prompt, state);
    const output = await this.runPrimitive(stepId, primitive, prompt, update => {
      this.hooks.onStepSessionUpdate(stepId, update);
    });
    return {
      lastOutput: output,
      stepOutputs: {
        [stepId]: { output },
      },
      events: [
        { stepId, status: 'started' },
        { stepId, status: 'completed' },
      ],
    };
  }

  private async runParallelBranch(
    pipeline: PipelineDefinition,
    step: PipelineParallelStepDefinition,
    branchId: string,
    primitiveId: string,
    state: PipelineGraphState,
  ): Promise<Partial<PipelineGraphState>> {
    const primitive = pipeline.primitives[primitiveId];
    this.hooks.onStepStart(step.id, primitive, branchId);
    const prompt = renderTemplate(primitive.prompt, state);
    const output = await this.runPrimitive(getParallelBranchNodeName(step.id, branchId), primitive, prompt, update => {
      this.hooks.onStepSessionUpdate(step.id, update, branchId);
    });
    return {
      stepOutputs: {
        [step.id]: {
          branches: {
            [branchId]: { output },
          },
        },
      },
      events: [
        { stepId: step.id, branchId, status: 'started' },
        { stepId: step.id, branchId, status: 'completed' },
      ],
    };
  }

  private async runPrimitive(
    kind: string,
    primitive: PipelinePrimitiveDefinition,
    prompt: string,
    onSessionUpdate: (update: SessionNotification) => void,
  ): Promise<string> {
    const responseText = await this.runAcpAgent(kind, prompt, onSessionUpdate);
    return primitive.output === 'proposed_plan'
      ? extractSingleProposedPlan(responseText)
      : responseText.trim();
  }
}

export function createInitialPipelineState(userPrompt: string): PipelineGraphState {
  return {
    userPrompt,
    stepOutputs: {},
    events: [],
    approvalRejected: false,
    lastOutput: '',
  };
}

export function renderTemplate(template: string, state: PipelineGraphState): string {
  return template.replace(/{{\s*([^}]+?)\s*}}/g, (_match, variable: string) => {
    const key = variable.trim();
    if (key === 'userPrompt') {
      return state.userPrompt;
    }
    const branchMatch = /^steps\.([A-Za-z0-9_-]+)\.branches\.([A-Za-z0-9_-]+)\.output$/.exec(key);
    if (branchMatch) {
      return state.stepOutputs[branchMatch[1]]?.branches?.[branchMatch[2]]?.output ?? '';
    }
    const stepMatch = /^steps\.([A-Za-z0-9_-]+)\.output$/.exec(key);
    if (stepMatch) {
      return state.stepOutputs[stepMatch[1]]?.output ?? '';
    }
    return '';
  });
}

function renderParallelOutput(step: PipelineParallelStepDefinition, state: PipelineGraphState): string {
  return step.branches
    .map(branch => {
      const output = state.stepOutputs[step.id]?.branches?.[branch.id]?.output ?? '';
      return `## ${branch.id}\n\n${output}`.trim();
    })
    .join('\n\n');
}

function mergeStepOutputs(left: PipelineStepOutputs, right: PipelineStepOutputs): PipelineStepOutputs {
  const merged: PipelineStepOutputs = { ...left };
  for (const [stepId, nextValue] of Object.entries(right)) {
    const currentValue = merged[stepId] ?? {};
    merged[stepId] = {
      output: nextValue.output ?? currentValue.output,
      branches: {
        ...(currentValue.branches ?? {}),
        ...(nextValue.branches ?? {}),
      },
    };
    if (Object.keys(merged[stepId].branches ?? {}).length === 0) {
      delete merged[stepId].branches;
    }
  }
  return merged;
}

function getParallelBranchNodeName(stepId: string, branchId: string): string {
  return `${stepId}__${branchId}`;
}

function getParallelJoinNodeName(stepId: string): string {
  return `${stepId}__join`;
}
