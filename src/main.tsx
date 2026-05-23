import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';

// Restore last route only for MetaMask DApp browser, which can reset URL to '/' on reload.
// In normal browsers this breaks address-bar navigation by replacing '/' with the
// previously opened route before React Router mounts.
const SESSION_ROUTE_KEY = 'app_last_route';
const savedRoute = sessionStorage.getItem(SESSION_ROUTE_KEY);
const isMetaMaskBrowser =
  /MetaMask/i.test(navigator.userAgent) ||
  Boolean((window as any).ethereum?.isMetaMask);
const isInternalSavedRoute =
  typeof savedRoute === 'string' &&
  savedRoute.startsWith('/') &&
  !savedRoute.startsWith('//') &&
  savedRoute !== '/';

if (isMetaMaskBrowser && isInternalSavedRoute && window.location.pathname === '/') {
  window.history.replaceState(null, '', savedRoute);
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
