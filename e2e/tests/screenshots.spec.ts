import { expect, test } from '@playwright/test';
import path from 'node:path';
import { openOffline } from './helpers';
import type { Page } from '@playwright/test';

const OUT = path.resolve(__dirname, '../../docs/screenshots');

test('screenshots: editor, cutting, nesting (1440×900)', async ({ page }) => {
  await openOffline(page, '/app/editor/11');
  await expect(page.getByTestId('cad-canvas')).toBeVisible();
  await page.getByTestId('mullion-2').click();
  await page.mouse.move(700, 450);
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}/editor.png` });

  // dark application theme variant, then back to the default light theme
  await page.getByTestId('app-theme-toggle').click();
  await page.getByTestId('tree-b1-f1').click();
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${OUT}/editor-dark.png` });
  await page.getByTestId('app-theme-toggle').click();

  await page.getByTestId('calculate').click();
  await expect(page.getByTestId('calc-drawer')).toBeVisible();
  await page.mouse.move(0, 450);
  await page.waitForTimeout(900); // let the drawer finish sliding in
  await page.screenshot({ path: `${OUT}/calc-drawer.png` });

  await page.goto('/app/cutting');
  await page.getByTestId('load-demo-cutting').click();
  await page.getByTestId('run-cutting').click();
  await expect(page.getByTestId('cutting-results')).toContainText('VALIDATOR PASSED');
  await page.waitForTimeout(4000);
  await page.screenshot({ path: `${OUT}/cutting.png` });

  await page.goto('/app/nesting');
  await page.getByTestId('load-demo-nesting').click();
  await page.getByTestId('run-nesting').click();
  await expect(page.getByTestId('nesting-results')).toContainText('VALIDATOR PASSED');
  await page.waitForTimeout(4000);
  await page.screenshot({ path: `${OUT}/nesting.png` });
});

test('screenshots: production, purchasing (1440×900), workstation on a phone (390×844)', async ({ page, browser }) => {
  await openOffline(page, '/app/editor/11');
  await expect(page.getByTestId('cad-canvas')).toBeVisible();
  await page.getByTestId('calculate').click();
  await expect(page.getByTestId('calc-drawer')).toBeVisible();
  await page.getByTestId('calc-drawer').getByRole('button', { name: 'Close drawer' }).click();

  // work order with some shop-floor progress
  await page.getByRole('link', { name: 'Production' }).click();
  await page.getByTestId('new-work-order').click();
  await page.getByTestId('new-wo-dialog').locator('[data-testid^="wo-run-"]').first().check();
  await page.getByTestId('wo-name').fill('Podium south — batch 1');
  await page.getByTestId('create-work-order').click();
  await expect(page.getByTestId('order-detail')).toBeVisible();
  await page.getByTestId('release-order').click();
  const codes = await page.evaluate(() => [...document.querySelectorAll('[data-testid^="chip-"]')].map((e) => e.getAttribute('data-testid')!.slice(5)));
  // drive progress through the workstation UI for a few parts (realistic flow)
  const station = page.getByRole('link', { name: 'Workstation' });
  const progress: [number, string[]][] = [
    [0, ['cutting:complete', 'machining:complete', 'assembly:start']],
    [1, ['cutting:complete', 'machining:start']],
    [2, ['cutting:complete']],
    [3, ['cutting:complete']],
    [4, ['cutting:start']],
    [5, ['cutting:block']],
    [codes.length - 1, ['receiving:complete', 'glazing:complete', 'qc:complete', 'dispatch:complete']],
    [codes.length - 2, ['receiving:complete', 'glazing:start']],
    [codes.length - 3, ['receiving:complete']],
  ];
  await station.click();
  for (const [i, steps] of progress) {
    for (const st of steps) {
      const [sid, action] = st.split(':');
      await page.getByTestId(`station-${sid}`).click();
      await page.getByTestId('scan-input').fill(codes[i]);
      await page.keyboard.press('Enter');
      await expect(page.getByTestId('part-code')).toHaveText(codes[i]);
      if (action === 'block') {
        await page.getByTestId('action-block').click();
        await page.getByTestId('action-note-text').fill('Surface scratch — awaiting QC decision');
        await page.getByTestId('action-confirm').click();
        await expect(page.getByTestId('part-panel')).toContainText('blocked');
      } else {
        await page.getByTestId(`action-${action}`).click();
        await expect(page.getByTestId('toaster')).toContainText(codes[i]);
      }
    }
  }
  await page.getByRole('link', { name: 'Production' }).click();
  await expect(page.getByTestId('station-board')).toBeVisible();
  await page.mouse.move(0, 0);
  await page.waitForTimeout(3800); // let toasts fade
  await page.screenshot({ path: `${OUT}/production.png` });

  // purchasing
  await page.getByRole('link', { name: 'Purchasing' }).click();
  await page.getByTestId('generate-po').click();
  await page.getByTestId('generate-po-dialog').locator('[data-testid^="po-run-"]').first().check();
  await page.getByTestId('create-po').click();
  await expect(page.getByTestId('po-detail')).toBeVisible();
  await page.getByTestId('po-supplier').fill('Demo Extrusions Pvt Ltd (fictitious)');
  await page.getByTestId('po-save').click();
  await page.waitForTimeout(3800);
  await page.screenshot({ path: `${OUT}/purchasing.png` });

  // quotation from the same calc run
  await page.getByRole('link', { name: 'Quotations' }).click();
  await page.locator('[data-testid^="quote-run-"]').first().check();
  await page.getByTestId('create-quote').click();
  await expect(page.getByTestId('quote-view')).toContainText('Demo prices');
  await page.mouse.move(0, 0);
  await page.waitForTimeout(3800);
  await page.screenshot({ path: `${OUT}/quotes.png` });

  // the same browser storage, on a phone-sized context
  const state = await page.context().storageState();
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, storageState: state });
  const p2 = await phone.newPage();
  await p2.goto('/app');
  await p2.getByTestId('continue-offline').or(p2.getByTestId('login-offline')).first().click({ timeout: 20_000 });
  await p2.goto('/app/station');
  await p2.getByTestId('station-machining').click();
  await p2.getByTestId('scan-input').fill(codes[1]);
  await p2.keyboard.press('Enter');
  await expect(p2.getByTestId('part-code')).toHaveText(codes[1]);
  const o = await p2.getByTestId('station-page').evaluate((el) => el.scrollWidth - el.clientWidth);
  expect(o).toBeLessThanOrEqual(0);
  await p2.screenshot({ path: `${OUT}/station-phone.png` });
  await phone.close();
});

/** Scroll through the page so lazy images load and scroll-reveal sections are shown, then return to the top. */
async function settle(page: Page) {
  await page.evaluate(async () => {
    document.documentElement.style.scrollBehavior = 'auto';
    const step = Math.max(200, Math.floor(window.innerHeight * 0.6));
    for (let y = 0; y < document.documentElement.scrollHeight; y += step) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 90));
    }
    window.scrollTo(0, 0);
  });
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(700);
}

test('screenshots: public website (light theme)', async ({ page, browser }) => {
  await page.route('**/api/**', (r) => r.abort());
  await page.goto('/');
  await page.evaluate(() => localStorage.setItem('fos.theme', 'light'));
  await page.goto('/');
  await expect(page.getByTestId('home-hero')).toBeVisible();
  await settle(page);
  await page.screenshot({ path: `${OUT}/site-home.png` });
  await page.screenshot({ path: `${OUT}/site-home-full.png`, fullPage: true });

  await page.goto('/pricing');
  await expect(page.getByTestId('plans')).toBeVisible();
  await settle(page);
  await page.screenshot({ path: `${OUT}/site-pricing.png`, fullPage: true });

  await page.goto('/solutions/cutting-nesting');
  await settle(page);
  await page.screenshot({ path: `${OUT}/site-solution.png`, fullPage: true });

  await page.goto('/contact');
  await settle(page);
  await page.screenshot({ path: `${OUT}/site-contact.png` });

  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const p2 = await phone.newPage();
  await p2.route('**/api/**', (r) => r.abort());
  await p2.goto('/');
  await expect(p2.getByTestId('home-hero')).toBeVisible();
  await settle(p2);
  await p2.screenshot({ path: `${OUT}/site-home-phone.png` });
  await p2.screenshot({ path: `${OUT}/site-home-phone-full.png`, fullPage: true });
  await phone.close();
});
