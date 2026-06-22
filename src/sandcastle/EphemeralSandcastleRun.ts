import type { EphemeralRunInput, EphemeralRunResult } from '../core/EphemeralRun';
import { runEphemeralRun } from '../core/EphemeralRun';
import type { FinishEphemeralRunOptions, SandcastlePromotion } from './SandcastlePromotion';
import type { SandcastlePromotionOutcome } from './SandcastlePromotionUi';

export interface EphemeralSandcastleRunResult {
  text: string;
  promotion?: SandcastlePromotionOutcome;
}

export interface EphemeralSandcastleRunInput extends EphemeralRunInput {
  sideEffects?: FinishEphemeralRunOptions['sideEffects'];
}

/**
 * Single seam for EphemeralRun + Promotion after a Sandcastle sandbox run.
 */
export async function finishEphemeralSandcastleRun(
  promotion: SandcastlePromotion,
  run: EphemeralRunResult,
  options: FinishEphemeralRunOptions = {},
): Promise<EphemeralSandcastleRunResult> {
  if (!run.sandbox) {
    return { text: run.text };
  }

  const promotionOutcome = await promotion.finishEphemeralRun(
    run.sandbox.connection,
    run.sandbox.sessionId,
    options,
  );

  return { text: run.text, promotion: promotionOutcome };
}

/**
 * Runs an ephemeral agent and finishes any Sandcastle sandbox through Promotion.
 */
export async function runEphemeralSandcastleAgent(
  promotion: SandcastlePromotion,
  input: EphemeralSandcastleRunInput,
): Promise<EphemeralSandcastleRunResult> {
  const { sideEffects, ...runInput } = input;
  const run = await runEphemeralRun(runInput);
  try {
    return await finishEphemeralSandcastleRun(promotion, run, { sideEffects });
  } finally {
    run.sandbox?.dispose();
  }
}
