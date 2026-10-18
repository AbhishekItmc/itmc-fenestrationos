/**
 * Top-level URL split between the public product website and the application.
 *
 *   /app, /app/...   application (startup mode check → login / offline → app)
 *   /p/:code         QR part labels (printed labels point here — must never move)
 *   everything else  public website (no API needed)
 *
 * Old top-level application paths (before the website existed) are redirected to /app/... so bookmarks keep working.
 */
export const APP_BASE = '/app';

/** Old top-level application path prefix → new /app path prefix. */
export const LEGACY_APP_PATHS: Record<string, string> = {
  '/projects': '/app/projects',
  '/editor': '/app/editor',
  '/catalogue': '/app/catalogue',
  '/glass': '/app/glass',
  '/calc': '/app/calc',
  '/cutting': '/app/cutting',
  '/nesting': '/app/nesting',
  '/inventory': '/app/inventory',
  '/quotes': '/app/quotes',
  '/quotations': '/app/quotes',
  '/reports': '/app/reports',
  '/admin': '/app/admin',
  '/production': '/app/production',
  '/station': '/app/station',
  '/purchasing': '/app/purchasing',
  '/login': '/app',
};

export function isAppPath(pathname: string): boolean {
  return pathname === APP_BASE || pathname.startsWith(`${APP_BASE}/`) || pathname.startsWith('/p/');
}

/**
 * Target for an old application URL, or null when `pathname` is not one.
 * Prefix match on whole segments: `/editor/11` → `/app/editor/11`, `/production/3/labels?layout=a4-8` keeps its query,
 * but `/projectsX` is not a legacy path.
 */
export function legacyRedirect(pathname: string, search = '', hash = ''): string | null {
  const clean = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
  for (const [from, to] of Object.entries(LEGACY_APP_PATHS)) {
    if (clean === from || clean.startsWith(`${from}/`)) {
      const rest = from === '/login' ? '' : clean.slice(from.length);
      return `${to}${rest}${search}${hash}`;
    }
  }
  return null;
}
