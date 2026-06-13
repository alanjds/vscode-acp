import React from 'react';
import ReactDOM from 'react-dom/client';

import { App } from './App';
import { DebugApp } from './DebugApp';

const rootElement = document.getElementById('root');

if (!rootElement) {
  throw new Error('Missing #root element for ACP Chat webview');
}

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    {document.body.dataset.viewKind === 'debug' ? <DebugApp /> : <App />}
  </React.StrictMode>,
);
