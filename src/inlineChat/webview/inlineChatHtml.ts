import * as vscode from 'vscode';

/**
 * Generate HTML for the inline chat webview
 */
export function getInlineChatHtml(_webview: vscode.Webview): string {
  const nonce = getNonce();

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta
    http-equiv="Content-Security-Policy"
    content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';"
  />
  <style>
    :root {
      --acp-space-sm: 8px;
      --acp-space-md: 12px;
      --acp-radius-sm: 4px;
      --acp-radius-md: 8px;
      --acp-text-secondary: var(--vscode-descriptionForeground);
      --acp-border: var(--vscode-panel-border);
    }

    body {
      padding: 0;
      margin: 0;
      color: var(--vscode-editor-foreground);
      background: transparent;
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
    }

    .container {
      margin: 4px 16px 4px 0;
      border: 1px solid var(--acp-border);
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      border-radius: var(--acp-radius-md);
      box-shadow: 0 4px 14px color-mix(in srgb, var(--vscode-widget-shadow, var(--vscode-foreground)) 20%, transparent);
      overflow: hidden;
    }

    .input-row {
      display: flex;
      align-items: stretch;
      gap: var(--acp-space-sm);
      padding: var(--acp-space-sm);
    }

    .header-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 6px var(--acp-space-sm) 0 var(--acp-space-sm);
    }

    .title {
      color: var(--acp-text-secondary);
      font-size: calc(var(--vscode-font-size) * 0.9);
      user-select: none;
    }

    .close-btn {
      border: none;
      background: transparent;
      color: var(--vscode-icon-foreground);
      border-radius: var(--acp-radius-sm);
      padding: 2px 6px;
      cursor: pointer;
      line-height: 1;
      font-size: calc(var(--vscode-font-size) * 1.2);
    }

    .close-btn:hover {
      background: var(--vscode-toolbar-hoverBackground);
    }

    textarea {
      flex: 1;
      resize: none;
      border: none;
      outline: none;
      color: var(--vscode-input-foreground);
      background: var(--vscode-input-background);
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      min-height: 42px;
      max-height: 120px;
    }

    button {
      border: none;
      border-radius: var(--acp-radius-sm);
      padding: 4px 10px;
      cursor: pointer;
      color: var(--vscode-button-foreground);
      background: var(--vscode-button-background);
      display: inline-flex;
      align-items: center;
      gap: 4px;
    }

    button.secondary {
      color: var(--vscode-button-secondaryForeground);
      background: var(--vscode-button-secondaryBackground);
    }

    .footer {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 6px var(--acp-space-sm);
      border-top: 1px solid var(--acp-border);
      color: var(--acp-text-secondary);
    }

    .actions {
      display: none;
      gap: 6px;
    }

    .actions.visible {
      display: flex;
    }

    .status {
      white-space: nowrap;
    }

    .btn-icon {
      width: 14px;
      height: 14px;
      fill: currentColor;
      flex-shrink: 0;
    }

    textarea:focus {
      outline: 1px solid var(--vscode-focusBorder);
      box-shadow: 0 0 0 1px var(--vscode-focusBorder);
    }

    button:hover:not(:disabled) {
      background: var(--vscode-button-hoverBackground);
    }

    button:disabled {
      color: var(--vscode-disabledForeground);
      cursor: not-allowed;
    }

    button.stop {
      min-width: 72px;
      background: var(--vscode-inputValidation-errorBackground);
      color: var(--vscode-inputValidation-errorForeground);
      border: 1px solid var(--vscode-inputValidation-errorBorder);
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header-row">
      <div class="title">Inline chat</div>
      <button id="close" class="close-btn" title="Close (Esc)" aria-label="Close">×</button>
    </div>
    <div class="input-row">
      <textarea
        id="prompt"
        placeholder="Ask Damien to edit this code..."
        autofocus
      ></textarea>
      <button id="submit" type="button" aria-label="Send">
        <svg class="btn-icon" viewBox="0 0 16 16" aria-hidden="true"><path d="M1 1.5 15 8 1 14.5V9l8-1-8-1V1.5z"/></svg>
        <span class="submit-label">Send</span>
      </button>
    </div>

    <div class="footer">
      <span id="status" class="status">Enter to send · Esc to cancel</span>

      <div id="actions" class="actions">
        <button id="accept">Accept</button>
        <button id="reject" class="secondary">Reject</button>
      </div>
    </div>
  </div>

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();

    const prompt = document.getElementById('prompt');
    const submit = document.getElementById('submit');
    const status = document.getElementById('status');
    const actions = document.getElementById('actions');
    const accept = document.getElementById('accept');
    const reject = document.getElementById('reject');
    const close = document.getElementById('close');
    let isThinking = false;

    prompt.focus();

    submit.addEventListener('click', () => {
      if (isThinking) {
        stopGeneration();
        return;
      }
      sendPrompt();
    });

    accept.addEventListener('click', () => {
      vscode.postMessage({ type: 'accept' });
    });

    reject.addEventListener('click', () => {
      vscode.postMessage({ type: 'reject' });
    });

    close.addEventListener('click', () => {
      vscode.postMessage({ type: 'cancel' });
    });

    prompt.addEventListener('keydown', event => {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        if (isThinking) {
          stopGeneration();
        } else {
          sendPrompt();
        }
      }

      if (event.key === 'Escape') {
        event.preventDefault();
        vscode.postMessage({ type: 'cancel' });
      }
    });

    function setThinking(thinking) {
      isThinking = thinking;
      if (thinking) {
        submit.innerHTML = '<svg class="btn-icon" viewBox="0 0 16 16" aria-hidden="true"><rect x="4" y="4" width="8" height="8" rx="1"/></svg><span class="submit-label">Stop</span>';
        submit.classList.add('stop');
        submit.disabled = false;
        prompt.disabled = true;
      } else {
        submit.innerHTML = '<svg class="btn-icon" viewBox="0 0 16 16" aria-hidden="true"><path d="M1 1.5 15 8 1 14.5V9l8-1-8-1V1.5z"/></svg><span class="submit-label">Send</span>';
        submit.classList.remove('stop');
        submit.disabled = false;
        prompt.disabled = false;
      }
    }

    function stopGeneration() {
      vscode.postMessage({ type: 'stop' });
    }

    window.addEventListener('message', event => {
      const message = event.data;

      if (message.type === 'status' && message.value === 'thinking') {
        const agent = message.agent || 'Damien';
        status.textContent = agent + ' is editing...';
        setThinking(true);
        actions.classList.remove('visible');
      }

      if (message.type === 'proposal') {
        status.textContent = message.summary || 'Proposal ready';
        actions.classList.add('visible');
        setThinking(false);
      }

      if (message.type === 'status' && message.value === 'ready') {
        status.textContent = 'Enter to send · Esc to cancel';
        setThinking(false);
      }

      if (message.type === 'status' && message.value === 'error') {
        status.textContent = 'Error occurred';
        setThinking(false);
      }
    });

    function sendPrompt() {
      const value = prompt.value.trim();

      if (!value) {
        return;
      }

      vscode.postMessage({
        type: 'submit',
        prompt: value
      });

      // Clear the input after sending
      prompt.value = '';
    }
  </script>
</body>
</html>`;
}

function getNonce(): string {
  let text = '';
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }

  return text;
}
