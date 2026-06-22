import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { runGit } from './runGit';

export type PromotionPreview = {
  diff: string;
  filesChanged: number;
  branch: string;
  baseRef: string;
  worktreePath: string;
};

export type ApplyToHostResult = {
  success: boolean;
  filesChanged: number;
  message: string;
};

/**
 * Calcule le diff binaire entre le worktree sandbox et la référence de base.
 *
 * @param worktreePath - Chemin du worktree isolé contenant les modifications potentielles.
 * @param baseRef - Référence Git de base (commit SHA) pour le diff.
 * @param branch - Nom de la branche éphémère Sandcastle.
 * @returns Métadonnées de promotion : diff, nombre de fichiers, branche, base et chemin worktree.
 */
export async function previewWorktreeChanges(
  worktreePath: string,
  baseRef: string,
  branch: string,
): Promise<PromotionPreview> {
  await runGit(worktreePath, ['add', '--intent-to-add', '--', '.']);
  const diff = await runGit(worktreePath, ['diff', '--binary', baseRef]);
  const names = await runGit(worktreePath, ['diff', '--name-only', baseRef]);
  return {
    diff,
    filesChanged: names.split('\n').map(value => value.trim()).filter(Boolean).length,
    branch,
    baseRef,
    worktreePath,
  };
}

/**
 * Applique le patch du worktree sur le dépôt hôte via `git apply`.
 *
 * @param hostCwd - Répertoire du dépôt hôte où appliquer le patch.
 * @param preview - Aperçu contenant le diff et le nombre de fichiers modifiés.
 * @returns Objet succès/échec avec nombre de fichiers et message utilisateur.
 */
export async function applyWorktreeToHost(
  hostCwd: string,
  preview: PromotionPreview,
): Promise<ApplyToHostResult> {
  if (!preview.diff.trim()) {
    return { success: true, filesChanged: 0, message: 'No changes to apply.' };
  }

  const patchPath = path.join(os.tmpdir(), `acp-sandcastle-${crypto.randomUUID()}.patch`);
  fs.writeFileSync(patchPath, preview.diff, 'utf8');
  try {
    await runGit(hostCwd, ['apply', '--check', patchPath]);
    await runGit(hostCwd, ['apply', patchPath]);
    return {
      success: true,
      filesChanged: preview.filesChanged,
      message: `Applied Sandcastle changes (${preview.filesChanged} file(s)).`,
    };
  } catch (error) {
    return {
      success: false,
      filesChanged: preview.filesChanged,
      message: error instanceof Error ? error.message : String(error),
    };
  } finally {
    try {
      fs.unlinkSync(patchPath);
    } catch {
      // Ignore temporary patch cleanup failures.
    }
  }
}
