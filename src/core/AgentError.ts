export type AgentErrorKind =
  | 'command-not-found'
  | 'handshake-failed'
  | 'initialization-timeout'
  | 'auth-cancelled'
  | 'missing-pipeline-agent'
  | 'unknown';

export interface ClassifiedAgentError {
  kind: AgentErrorKind;
  message: string;
  actionHint: string;
}

export function classifyAgentError(error: unknown): ClassifiedAgentError {
  const rawMessage = error instanceof Error
    ? error.message
    : typeof error === 'string'
      ? error
      : String((error as any)?.message || error || 'Unknown error');
  const message = rawMessage || 'Unknown error';
  const lower = message.toLowerCase();

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
