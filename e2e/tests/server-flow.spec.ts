import { expect, test } from '@playwright/test';

/**
 * Server-mode integration (skipped when /api/v1/health is not reachable through the preview proxy).
 * Requires demo users: SEED_DEMO_USERS=1, DEMO_PASSWORD (default used by the dev setup below).
 */
const EMAIL = process.env.E2E_EMAIL ?? 'admin@demo.local';
const PASSWORD = process.env.E2E_PASSWORD ?? 'Demo@12345';

test.beforeEach(async ({ request }) => {
  const ok = await request
    .get('/api/v1/health')
    .then((r) => r.ok() && (r.headers()['content-type'] ?? '').includes('json'))
    .catch(() => false);
  test.skip(!ok, 'backend not reachable — server-mode e2e skipped');
});

test('server: login → project → elevation → persisted calc → cutting job → nesting → quote', async ({ page }) => {
  await page.goto('/app');
  await page.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
  await page.goto('/app');
  await page.getByTestId('login-email').fill(EMAIL);
  await page.getByTestId('login-password').fill(PASSWORD);
  await page.getByTestId('login-submit').click();
  await expect(page.getByTestId('mode-indicator')).toHaveText(/SERVER/);

  // project
  const code = `E2E-${Date.now().toString(36).toUpperCase()}`;
  await page.getByTestId('new-project').click();
  await page.getByTestId('project-code').fill(code);
  await page.getByTestId('project-name').fill('E2E server project');
  await page.getByTestId('project-save').click();
  await expect(page.getByTestId('projects-table')).toContainText(code);
  await page.getByTestId('project-select').selectOption({ label: `${code} · E2E server project` });

  // elevation via wizard (saved to the project → server)
  await page.getByRole('link', { name: 'Elevation CAD' }).click();
  await page.getByTestId('new-elevation').click();
  await page.getByTestId('wizard-name').fill('E2E server elevation');
  await page.getByTestId('wizard-create').click();
  await expect(page).toHaveURL(/\/editor\/\d+$/);
  await expect(page.getByTestId('toaster')).toContainText('Elevation created');

  // edit + save (optimistic version)
  await page.getByTestId('tool-mullion').click();
  const box = (await page.getByTestId('field-b0-f0').boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.getByTestId('save').click();
  await expect(page.getByTestId('toaster')).toContainText('version 2');

  // persisted calculation run
  await page.getByTestId('calculate').click();
  const drawer = page.getByTestId('calc-drawer');
  await expect(drawer).toContainText('VALIDATOR PASSED');
  await expect(drawer).toContainText(/run #\d+/);

  // 1D cutting on the server, save job
  await drawer.getByTestId('send-to-cutting').click();
  await page.getByTestId('run-cutting').click();
  await expect(page.getByTestId('cutting-results')).toContainText('VALIDATOR PASSED');
  await expect(page.getByTestId('cutting-results')).not.toContainText('Offline demo engine');
  await page.getByTestId('save-cutting-job').click();
  await expect(page.getByTestId('save-cutting-job')).toContainText('Saved');

  // 2D nesting on the server
  await page.getByRole('link', { name: '2D Nesting' }).click();
  await page.getByTestId('load-demo-nesting').click();
  await page.getByTestId('run-nesting').click();
  await expect(page.getByTestId('nesting-results')).toContainText('VALIDATOR PASSED');

  // quotation from the persisted calc run
  await page.getByRole('link', { name: 'Quotations' }).click();
  await page.locator('[data-testid^="quote-run-"]').first().check();
  await page.getByTestId('create-quote').click();
  await expect(page.getByTestId('quote-view')).toContainText('Demo prices — not a commercial offer');
  await expect(page.getByTestId('quote-total')).toContainText(/\d/);
});

test('server: website demo request appears in Admin → Leads and can be marked contacted', async ({ page, request }) => {
  const company = `E2E Facades ${Date.now().toString(36)}`;
  const r = await request.post('/api/v1/leads', {
    data: { name: 'E2E Visitor', company, email: 'e2e.visitor@example.com', message: 'Automated e2e demo request.', interest: ['cutting-nesting'], website: '', elapsed_ms: 5000, source_page: '/contact' },
  });
  test.skip(r.status() === 429, 'lead rate limit reached for this IP (5/hour) — rerun later');
  expect(r.status()).toBe(201);
  expect(await r.json()).toEqual({ ok: true });

  await page.goto('/app');
  await page.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
  await page.goto('/app');
  await page.getByTestId('login-email').fill(EMAIL);
  await page.getByTestId('login-password').fill(PASSWORD);
  await page.getByTestId('login-submit').click();
  await expect(page.getByTestId('mode-indicator')).toHaveText(/SERVER/);
  await page.goto('/app/admin');
  await page.getByRole('tab', { name: 'Leads' }).click();
  const row = page.getByTestId('leads-table').locator('tr', { hasText: company });
  await expect(row).toBeVisible();
  await row.locator('select').selectOption('contacted');
  await expect(page.getByTestId('toaster')).toContainText('contacted');
  await expect(page.getByTestId('leads-table').locator('tr', { hasText: company })).toContainText('contacted');
});
