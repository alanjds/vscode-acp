import { getAgentConfig, isSandcastleAgentConfig } from '../config/AgentConfig';
import type { FinishEphemeralRunOptions } from '../sandcastle/SandcastlePromotion';
import type { SandcastlePromotion } from '../sandcastle/SandcastlePromotion';
import {
  runEphemeralSandcastleAgent,
  type EphemeralSandcastleRunResult,
} from '../sandcastle/EphemeralSandcastleRun';
import { runEphemeralRun, type EphemeralRunInput } from './EphemeralRun';

export type EphemeralAgentRunResult = EphemeralSandcastleRunResult;

export interface EphemeralAgentRunnerInput extends EphemeralRunInput {
  sideEffects?: FinishEphemeralRunOptions['sideEffects'];
}

export interface EphemeralAgentRunner {
  run(input: EphemeralAgentRunnerInput): Promise<EphemeralAgentRunResult>;
}

/**
 * Routes EphemeralRun to native ACP or Sandcastle+Promotion based on agent config.
 */
export class DefaultEphemeralAgentRunner implements EphemeralAgentRunner {
  constructor(private readonly sandcastlePromotion?: SandcastlePromotion) {}

  async run(input: EphemeralAgentRunnerInput): Promise<EphemeralAgentRunResult> {
    const config = getAgentConfig(input.agentName);
    if (!config) {
      throw new Error(`Agent "${input.agentName}" is not configured in acp.agents.`);
    }

    if (isSandcastleAgentConfig(config)) {
      if (!this.sandcastlePromotion) {
        throw new Error('Sandcastle promotion is required for Sandcastle agents.');
      }
      return runEphemeralSandcastleAgent(this.sandcastlePromotion, input);
    }

    const { sideEffects: _sideEffects, ...runInput } = input;
    const result = await runEphemeralRun(runInput);
    return { text: result.text };
  }
}
