import { getAgentConfig } from '../../config/AgentConfig';
import {
  isVirtualAgentName,
  listSelectableAgentNames,
  resolveAgent,
} from '../../config/VirtualAgentCatalog';

export type RunnableInlineAgent = {
  name: string;
  displayName: string;
};

export interface ActiveAgentResolver {
  resolveRunnableAgent(): RunnableInlineAgent;
}

export class SessionBackedActiveAgentResolver implements ActiveAgentResolver {
  constructor(
    private readonly workspaceCwd: () => string,
    private readonly getActiveAgentName: () => string | undefined,
  ) {}

  resolveRunnableAgent(): RunnableInlineAgent {
    const cwd = this.workspaceCwd();
    const activeName = this.getActiveAgentName();

    if (activeName && !isVirtualAgentName(activeName, cwd)) {
      return this.toRunnable(activeName);
    }

    const fallback = listSelectableAgentNames(cwd).find(
      name => resolveAgent(name, cwd)?.kind === 'configured',
    );
    if (!fallback) {
      throw new Error('No ACP agent configured. Add agents in acp.agents settings.');
    }
    return this.toRunnable(fallback);
  }

  private toRunnable(name: string): RunnableInlineAgent {
    const cfg = getAgentConfig(name);
    return { name, displayName: cfg?.displayName ?? name };
  }
}
