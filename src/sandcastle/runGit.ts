import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export const GIT_MAX_BUFFER = 20 * 1024 * 1024;

/**
 * Exécute une commande Git dans un répertoire de travail donné.
 *
 * @param cwd - Répertoire courant pour l'exécution de `git`.
 * @param args - Arguments passés à l'exécutable `git`.
 * @returns Sortie standard de la commande (encodage UTF-8).
 */
export async function runGit(cwd: string, args: string[]): Promise<string> {
  const result = await execFileAsync('git', args, {
    cwd,
    encoding: 'utf8',
    maxBuffer: GIT_MAX_BUFFER,
  });
  return result.stdout.toString();
}
