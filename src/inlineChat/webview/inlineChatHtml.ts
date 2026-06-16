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
      border: 1px solid var(--vscode-input-border);
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      border-radius: 6px;
      box-shadow: 0 4px 14px rgba(0, 0, 0, 0.25);
      overflow: hidden;
    }

    .input-row {
      display: flex;
      align-items: stretch;
      gap: 8px;
      padding: 8px;
    }

    .header-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 6px 8px 0 8px;
    }

    .title {
      color: var(--vscode-descriptionForeground);
      font-size: calc(var(--vscode-font-size) * 0.9);
      user-select: none;
    }

    .close-btn {
      border: none;
      background: transparent;
      color: var(--vscode-icon-foreground);
      border-radius: 4px;
      padding: 2px 6px;
      cursor: pointer;
      line-height: 1;
      font-size: calc(var(--vscode-font-size) * 1.2);
    }

    .close-btn:hover {
      background: rgba(127, 127, 127, 0.15);
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
      border-radius: 4px;
      padding: 4px 10px;
      cursor: pointer;
      color: var(--vscode-button-foreground);
      background: var(--vscode-button-background);
    }

    button.secondary {
      color: var(--vscode-button-secondaryForeground);
      background: var(--vscode-button-secondaryBackground);
    }

    .footer {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 6px 8px;
      border-top: 1px solid var(--vscode-input-border);
      color: var(--vscode-descriptionForeground);
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

    textarea:focus {
      outline: 1px solid var(--vscode-focusBorder);
    }

    button:hover {
      opacity: 0.8;
    }

    button:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    button.stop {
      min-width: 52px;
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
      <button id="submit">Send</button>
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
        submit.textContent = '■ Stop';
        submit.classList.add('stop');
        submit.disabled = false;
        prompt.disabled = true;
      } else {
        submit.textContent = 'Send';
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
