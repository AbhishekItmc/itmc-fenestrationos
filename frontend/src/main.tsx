import { lazy, StrictMode, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource/ibm-plex-sans/400.css';
import '@fontsource/ibm-plex-sans/500.css';
import '@fontsource/ibm-plex-sans/600.css';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/500.css';
import './index.css';
import './store/theme';
import { isAppPath, legacyRedirect } from './routes';

// Old top-level application URLs (bookmarks from before the website existed) → /app/...
const { pathname, search, hash } = window.location;
const legacy = legacyRedirect(pathname, search, hash);
if (legacy) window.history.replaceState(window.history.state, '', legacy);

// Two separately code-split bundles: the public website never loads the application (and never needs the API).
const appMode = isAppPath(window.location.pathname);
document.documentElement.classList.toggle('is-site', !appMode);

const Root = appMode ? lazy(() => import('./App').then((m) => ({ default: m.App }))) : lazy(() => import('./site/SiteApp'));

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Suspense fallback={null}>
      <Root />
    </Suspense>
  </StrictMode>,
);
