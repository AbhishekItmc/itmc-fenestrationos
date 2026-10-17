import { defineConfig, devices } from '@playwright/test';

/**
 * E2E against `vite preview` of the production build. Without a backend on :8000 the app falls back to
 * offline demo mode (the specs click "Continue in offline demo mode" either way).
 * Browsers: PLAYWRIGHT_BROWSERS_PATH (e.g. /opt/pw-browsers) — do not run `playwright install` in CI images that ship them.
 */
const PORT = Number(process.env.E2E_PORT ?? 4173);

export default defineConfig({
  testDir: './tests',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${PORT}`,
    viewport: { width: 1440, height: 900 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } }],
  webServer: {
    command: `npm --prefix ../frontend run build && npm --prefix ../frontend run preview -- --port ${PORT}`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
