import { RequestError } from '@agentclientprotocol/sdk';

export type AgentErrorKind =
  | 'command-not-found'
  | 'handshake-failed'
  | 'initialization-timeout'
  | 'auth-cancelled'
  | 'missing-pipeline-agent'
  | 'provider-quota'
  | 'provider-auth'
  | 'unknown';

function readErrorDataDetails(error: unknown): string | undefined {
  if (error instanceof RequestError) {
    const data = error.data as { details?: unknown } | undefined;
    if (typeof data?.details === 'string' && data.details.trim()) {
      return data.details.trim();
    }
  }

  const data = (error as { data?: { details?: unknown } } | undefined)?.data;
  if (typeof data?.details === 'string' && data.details.trim()) {
    return data.details.trim();
  }
  return undefined;
}

/** Prefer agent-provided details over generic JSON-RPC wrappers like "Internal error". */
export function formatAgentErrorMessage(error: unknown): string {
  const details = readErrorDataDetails(error);
  if (details) {
    return details;
  }
  if (error instanceof Error && error.message.trim() && error.message !== 'Internal error') {
    return error.message.trim();
  }
  return 'An unexpected agent error occurred.';
}

export interface ClassifiedAgentError {
  kind: AgentErrorKind;
  message: string;
  actionHint: string;
}

export function classifyAgentError(error: unknown): ClassifiedAgentError {
  const rawMessage = formatAgentErrorMessage(error);
  const message = rawMessage || 'Unknown error';
  const lower = message.toLowerCase();

  if (/usage limit|no credits remaining|rate.?limit|quota|credits/.test(lower)) {
    return {
      kind: 'provider-quota',
      message,
      actionHint: 'Check Codex usage at https://chatgpt.com/codex/settings/usage, upgrade your plan, or wait for the limit to reset.',
    };
  }

  if (/401 unauthorized|missing bearer|invalid api key|authentication/.test(lower)) {
    return {
      kind: 'provider-auth',
      message,
      actionHint: 'Set a valid OpenAI API key in .sandcastle/.env or re-authenticate Codex on the host.',
    };
  }

  if (/missing configured acp pipeline agent/.test(lower)) {
    return {
      kind: 'missing-pipeline-agent',
      message,
      actionHint: 'Check .acp/pipelines/*.yaml and configured acp.agents.',
    };
  }

  if (/authentication cancelled|auth.*cancelled|cancelled by user/.test(lower)) {
    return {
      kind: 'auth-cancelled',
      message,
      actionHint: 'Retry connection when you are ready to authenticate.',
    };
  }

  if (/timed out|timeout/.test(lower)) {
    return {
      kind: 'initialization-timeout',
      message,
      actionHint: 'Check that the agent starts and answers ACP initialize requests.',
    };
  }

  if (/command not found|enoent|not recognized as|spawn .* enoent/.test(lower)) {
    return {
      kind: 'command-not-found',
      message,
      actionHint: 'Check the agent command, PATH, or launch VS Code from the right shell.',
    };
  }

  if (/missing stdio|initialize|initializ|handshake|closed|exited|eof|broken pipe/.test(lower)) {
    return {
      kind: 'handshake-failed',
      message,
      actionHint: 'Open ACP logs and verify the agent supports ACP over stdio.',
    };
  }

  return {
    kind: 'unknown',
    message,
    actionHint: 'Open ACP logs for details and retry after fixing the agent configuration.',
  };
}
