import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { getSandboxConfig } from './SandboxConfig';
import type { SandboxContext, SandboxCreateOptions } from './SandboxContext';
import { defaultGitCommandRunner, type GitCommandRunner } from './GitCommandRunner';
import { SandboxRegistry } from './SandboxRegistry';
import { log, logError } from '../utils/Logger';

export class SandboxService {
  constructor(
    private readonly registry: SandboxRegistry = new SandboxRegistry(),
    private readonly git: GitCommandRunner = defaultGitCommandRunner,
  ) {}

  getRegistry(): SandboxRegistry {
    return this.registry;
  }

  async isGitRepo(baseCwd: string): Promise<boolean> {
    try {
      await this.git.exec(baseCwd, ['rev-parse', '--git-dir']);
      return true;
    } catch {
      return false;
    }
  }

  async create(baseCwd: string, options: SandboxCreateOptions = {}): Promise<SandboxContext> {
    const resolvedBase = path.resolve(baseCwd);
    if (!(await this.isGitRepo(resolvedBase))) {
      throw new Error(`Sandbox requires a git repository at ${resolvedBase}.`);
    }

    const config = getSandboxConfig();
    const id = crypto.randomUUID().slice(0, 8);
    const branch = `sandbox/${id}`;
    const sandboxRoot = path.join(resolvedBase, config.directory, id);
    const baseRef = await this.resolveBaseRef(resolvedBase, options.baseRef ?? config.baseBranch);

    fs.mkdirSync(path.dirname(sandboxRoot), { recursive: true });

    try {
      await this.git.exec(resolvedBase, [
        'worktree',
        'add',
        '-b',
        branch,
        sandboxRoot,
        baseRef,
      ]);
    } catch (error) {
      if (fs.existsSync(sandboxRoot)) {
        fs.rmSync(sandboxRoot, { recursive: true, force: true });
      }
      throw error;
    }

    const context: SandboxContext = {
      id,
      root: sandboxRoot,
      baseCwd: resolvedBase,
      baseRef,
      branch,
      createdAt: new Date().toISOString(),
    };
    this.registry.register(context);
    log(`Sandbox created: ${sandboxRoot} (branch ${branch}, base ${baseRef})`);
    return context;
  }

  async destroy(contextOrId: SandboxContext | string): Promise<void> {
    const context = typeof contextOrId === 'string'
      ? this.registry.get(contextOrId)
      : contextOrId;
    if (!context) {
      return;
    }

    try {
      await this.git.exec(context.baseCwd, ['worktree', 'remove', '--force', context.root]);
    } catch (error) {
      logError(`Sandbox worktree remove failed for ${context.id}`, error);
      if (fs.existsSync(context.root)) {
        fs.rmSync(context.root, { recursive: true, force: true });
      }
    }

    try {
      await this.git.exec(context.baseCwd, ['worktree', 'prune']);
    } catch (error) {
      logError(`Sandbox worktree prune failed for ${context.id}`, error);
    }

    try {
      await this.git.exec(context.baseCwd, ['branch', '-D', context.branch]);
    } catch {
      // Branch may already be gone.
    }

    this.registry.remove(context.id);
    log(`Sandbox destroyed: ${context.id}`);
  }

  async cleanupStale(ttlMs?: number): Promise<number> {
    const config = getSandboxConfig();
    const maxAge = ttlMs ?? config.staleTtlMs;
    const cutoff = Date.now() - maxAge;
    let removed = 0;

    for (const context of this.registry.list()) {
      const createdAt = Date.parse(context.createdAt);
      if (Number.isNaN(createdAt) || createdAt < cutoff) {
        await this.destroy(context);
        removed += 1;
      }
    }

    return removed;
  }

  private async resolveBaseRef(baseCwd: string, configuredBranch: string): Promise<string> {
    if (configuredBranch.trim()) {
      const branch = configuredBranch.trim();
      await this.git.exec(baseCwd, ['rev-parse', '--verify', branch]);
      return branch;
    }

    const { stdout } = await this.git.exec(baseCwd, ['rev-parse', 'HEAD']);
    return stdout.trim();
  }
}
