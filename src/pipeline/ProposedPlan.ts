const OPEN_TAG = '<proposed_plan>';
const CLOSE_TAG = '</proposed_plan>';
const PROPOSED_PLAN_RE = /<proposed_plan>[\s\S]*?<\/proposed_plan>/g;

export function extractSingleProposedPlan(text: string): string {
  const matches = text.match(PROPOSED_PLAN_RE) ?? [];
  if (matches.length !== 1) {
    throw new Error(
      matches.length === 0
        ? `Planner response did not include a ${OPEN_TAG} block.`
        : `Planner response included ${matches.length} ${OPEN_TAG} blocks; expected exactly one.`,
    );
  }
  return matches[0].trim();
}

export function assertSingleProposedPlan(text: string): void {
  const matches = text.match(PROPOSED_PLAN_RE) ?? [];
  if (matches.length !== 1) {
    throw new Error(
      matches.length === 0
        ? `The approved plan must include one ${OPEN_TAG} block.`
        : `The approved plan must include exactly one ${OPEN_TAG} block; found ${matches.length}.`,
    );
  }
  const plan = matches[0];
  const before = text.slice(0, text.indexOf(plan)).trim();
  const after = text.slice(text.indexOf(plan) + plan.length).trim();
  if (before || after) {
    throw new Error(`The approved plan must contain only one ${OPEN_TAG}...${CLOSE_TAG} block.`);
  }
}

