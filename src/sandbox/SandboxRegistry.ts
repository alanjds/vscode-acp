import type { SandboxContext } from './SandboxContext';

export class SandboxRegistry {
  private readonly entries = new Map<string, SandboxContext>();
  private activeId: string | null = null;

  register(context: SandboxContext): void {
    this.entries.set(context.id, context);
    this.activeId = context.id;
  }

  get(id: string): SandboxContext | undefined {
    return this.entries.get(id);
  }

  getActive(): SandboxContext | undefined {
    return this.activeId ? this.entries.get(this.activeId) : undefined;
  }

  list(): SandboxContext[] {
    return [...this.entries.values()];
  }

  remove(id: string): void {
    this.entries.delete(id);
    if (this.activeId === id) {
      this.activeId = this.entries.size > 0
        ? [...this.entries.keys()].at(-1) ?? null
        : null;
    }
  }

  clear(): void {
    this.entries.clear();
    this.activeId = null;
  }
}
