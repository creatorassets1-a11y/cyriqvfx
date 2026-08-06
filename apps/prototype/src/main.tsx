import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import './styles/tokens.css';
import './styles/app.css';

const container = document.getElementById('root');
if (!container) throw new Error('Missing #root');

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

/*
 * Register the service worker so the app installs and runs offline.
 *
 * Only over http(s): the standalone single-file build runs from file://, where
 * service workers are unavailable and the registration would throw. It does not
 * need one there — that build has nothing to fetch.
 */
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  window.addEventListener('load', () => {
    // Resolved against the document, not against import.meta.url — the bundle
    // lives in assets/, so a URL relative to it would look for assets/sw.js.
    navigator.serviceWorker
      .register('./sw.js', { scope: './' })
      .catch(() => {
        // An unregistered worker costs offline support, not the app.
      });
  });
}
