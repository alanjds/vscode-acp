import type { SandcastlePreview, SandcastlePromotionMode } from './SandcastlePromotionUi';

export type PromotionPolicyDecision =
  | 'discard_no_changes'
  | 'auto_apply'
  | 'auto_reject'
  | 'prompt';

/**
 * Pure policy for Sandcastle promotion — no VS Code UI or bridge calls.
 */
export function decidePromotionPolicy(
  preview: SandcastlePreview,
  mode: SandcastlePromotionMode,
): PromotionPolicyDecision {
  if (preview.filesChanged === 0) {
    return 'discard_no_changes';
  }
  if (mode === 'autoApply') {
    return 'auto_apply';
  }
  if (mode === 'autoReject') {
    return 'auto_reject';
  }
  return 'prompt';
}
