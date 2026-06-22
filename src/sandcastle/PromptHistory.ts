/** Entrée d'historique de conversation (rôle et texte) pour l'injection dans un prompt. */
export interface PromptHistoryEntry {
  role: 'user' | 'assistant';
  text: string;
}

const MAX_MESSAGES = 16;
const MAX_BYTES = 64 * 1024;

/**
 * Construit un prompt enrichi avec le transcript des échanges précédents, dans les limites de taille.
 *
 * Sélectionne au plus 16 messages récents dont la taille cumulée avec le prompt courant ne dépasse pas 64 KiB.
 *
 * @param history - Historique chronologique des messages utilisateur et assistant.
 * @param currentPrompt - Texte du prompt actuel à envoyer à l'agent.
 * @returns Le prompt seul si l'historique est vide ou trop volumineux ; sinon un prompt avec contexte conversationnel.
 */
export function buildPromptWithHistory(
  history: readonly PromptHistoryEntry[],
  currentPrompt: string,
): string {
  const selected: PromptHistoryEntry[] = [];
  let bytes = Buffer.byteLength(currentPrompt, 'utf8');

  for (let index = history.length - 1; index >= 0 && selected.length < MAX_MESSAGES; index -= 1) {
    const entry = history[index];
    const entryBytes = Buffer.byteLength(entry.text, 'utf8');
    if (bytes + entryBytes > MAX_BYTES) {
      break;
    }
    selected.unshift(entry);
    bytes += entryBytes;
  }

  if (selected.length === 0) {
    return currentPrompt;
  }

  const transcript = selected
    .map(entry => `${entry.role === 'user' ? 'User' : 'Assistant'}:\n${entry.text}`)
    .join('\n\n');
  return [
    'Continue this conversation using the prior context below.',
    '',
    transcript,
    '',
    'Current user request:',
    currentPrompt,
  ].join('\n');
}
