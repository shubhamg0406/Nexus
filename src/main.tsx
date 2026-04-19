import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';

declare global {
  interface Window {
    __NEXUS_BOOTED__?: boolean;
  }
}

window.__NEXUS_BOOTED__ = true;

const bootFallback = document.getElementById('boot-fallback');
if (bootFallback) {
  bootFallback.style.display = 'none';
}

function showBootError(message: string) {
  const id = 'nexus-boot-error';
  let panel = document.getElementById(id);
  if (!panel) {
    panel = document.createElement('pre');
    panel.id = id;
    panel.style.position = 'fixed';
    panel.style.left = '12px';
    panel.style.right = '12px';
    panel.style.bottom = '12px';
    panel.style.zIndex = '999999';
    panel.style.maxHeight = '50vh';
    panel.style.overflow = 'auto';
    panel.style.margin = '0';
    panel.style.padding = '12px';
    panel.style.border = '1px solid #ef4444';
    panel.style.borderRadius = '10px';
    panel.style.background = '#fff1f2';
    panel.style.color = '#7f1d1d';
    panel.style.fontSize = '12px';
    panel.style.fontFamily = 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace';
    document.body.appendChild(panel);
  }
  panel.textContent = message;
}

window.addEventListener('error', (event) => {
  const error = event.error instanceof Error ? `${event.error.name}: ${event.error.message}\n${event.error.stack || ''}` : String(event.message);
  showBootError(`Runtime error:\n${error}`);
});

window.addEventListener('unhandledrejection', (event) => {
  const reason = event.reason instanceof Error ? `${event.reason.name}: ${event.reason.message}\n${event.reason.stack || ''}` : String(event.reason);
  showBootError(`Unhandled promise rejection:\n${reason}`);
});

try {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
} catch (error) {
  const message = error instanceof Error ? `${error.name}: ${error.message}\n${error.stack || ''}` : String(error);
  showBootError(`Boot render failed:\n${message}`);
}
