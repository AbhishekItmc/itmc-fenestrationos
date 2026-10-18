import { expect, type Page } from '@playwright/test';

/** Open the app and enter offline demo mode (works whether or not a backend is reachable). */
export async function openOffline(page: Page, path = '/app/projects'): Promise<void> {
  await page.goto('/app');
  await page.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
  await page.goto('/app');
  const offline = page.getByTestId('continue-offline').or(page.getByTestId('login-offline'));
  await offline.first().click({ timeout: 20_000 });
  await expect(page.getByTestId('mode-indicator')).toHaveText(/OFFLINE DEMO/);
  if (path !== '/app/projects') await page.goto(path);
}

export async function mullionCount(page: Page): Promise<number> {
  return page.locator('[data-testid^="mullion-"]').count();
}
