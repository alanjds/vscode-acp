import { SkillsCatalog } from './SkillsCatalog';
import { isSkillsEnabledAgent } from './SkillsConfig';

export interface SkillsPromptInput {
  agentName: string;
  workspaceCwd: string;
  text: string;
  skillsBootstrapped: boolean;
}

export interface SkillsPromptResult {
  text: string;
  skillsBootstrapped: boolean;
}

const SKILL_INVOCATION_PATTERN = /^\/([a-zA-Z0-9][\w-]*)\b(?:\s+([\s\S]*))?$/;

function expandSkillInvocation(
  catalog: SkillsCatalog,
  skillName: string,
  remainder: string,
): string | null {
  const resolved = catalog.resolveSkill(skillName);
  if (!resolved) {
    return null;
  }

  const parts = [
    `<skill name="${resolved.entry.name}">`,
    resolved.content.trim(),
    '</skill>',
  ];
  if (remainder.trim()) {
    parts.push('', remainder.trim());
  }
  return parts.join('\n');
}

export function buildPromptWithSkills(input: SkillsPromptInput): SkillsPromptResult {
  if (!isSkillsEnabledAgent(input.agentName)) {
    return { text: input.text, skillsBootstrapped: input.skillsBootstrapped };
  }

  const catalog = new SkillsCatalog(input.workspaceCwd);
  const trimmed = input.text.trim();
  const skillMatch = trimmed.match(SKILL_INVOCATION_PATTERN);

  if (skillMatch) {
    const expanded = expandSkillInvocation(catalog, skillMatch[1], skillMatch[2] || '');
    if (expanded) {
      return {
        text: expanded,
        skillsBootstrapped: true,
      };
    }
  }

  if (input.skillsBootstrapped) {
    return { text: input.text, skillsBootstrapped: true };
  }

  const catalogText = catalog.buildCatalogText();
  if (!catalogText) {
    return { text: input.text, skillsBootstrapped: true };
  }

  const prefixed = [
    '<available_skills>',
    catalogText,
    '</available_skills>',
    '',
    input.text,
  ].join('\n');

  return {
    text: prefixed,
    skillsBootstrapped: true,
  };
}
