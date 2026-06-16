export interface SandboxContext {
  id: string;
  root: string;
  baseCwd: string;
  baseRef: string;
  branch: string;
  createdAt: string;
}

export interface SandboxCreateOptions {
  baseRef?: string;
}
