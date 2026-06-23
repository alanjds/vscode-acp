import * as path from 'path';

/**
 * Repository root for tests compiled to out/src/test/*.test.js.
 */
export function repoRoot(): string {
  return path.join(__dirname, '..', '..', '..');
}
