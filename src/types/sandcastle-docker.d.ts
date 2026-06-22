declare module '@ai-hero/sandcastle/sandboxes/docker' {
  import type { CreateSandboxOptions } from '@ai-hero/sandcastle';

  export interface MountConfig {
    hostPath: string;
    sandboxPath: string;
    readonly?: boolean;
  }

  export interface DockerOptions {
    imageName?: string;
    cpus?: number;
    env?: Record<string, string>;
    network?: string | readonly string[];
    mounts?: readonly MountConfig[];
  }

  export function docker(
    options?: DockerOptions,
  ): CreateSandboxOptions['sandbox'];
}
