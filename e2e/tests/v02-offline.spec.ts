import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { openOffline } from './helpers';

/** Persist a calc run for elevation 11 (saved + not dirty → the editor creates a stored run). */
async function calcRun(page: Page): Promise<void> {
  await page.goto('/editor/11');
  await expect(page.getByTestId('cad-canvas')).toBeVisible();
  await page.getByTestId('calculate').click();
  await expect(page.getByTestId('calc-drawer')).toBeVisible();
  await page.getByTestId('calc-drawer').getByRole('button', { name: 'Close drawer' }).click();
  await expect(page.getByTestId('calc-drawer')).toBeHidden();
}

async function createWorkOrder(page: Page): Promise<number> {
  await page.getByRole('link', { name: 'Production' }).click();
  await page.getByTestId('new-work-order').click();
  const dlg = page.getByTestId('new-wo-dialog');
  await dlg.locator('[data-testid^="wo-run-"]').first().check();
  await expect(dlg.getByTestId('wo-part-estimate')).toContainText('parts');
  await dlg.getByTestId('create-work-order').click();
  await expect(page.getByTestId('order-detail')).toBeVisible();
  const total = Number((await page.getByTestId('kpi-total').innerText()).replace(/\D+/g, ''));
  expect(total).toBeGreaterThan(20);
  return total;
}

test('offline: work order from a calc → QR labels → scan at station → part page', async ({ page }) => {
  await openOffline(page);
  await calcRun(page);
  const total = await createWorkOrder(page);
  await expect(page.getByTestId('order-number')).toHaveText(/^WO-\d{4}-0001$/);
  await expect(page.getByTestId('order-pct')).toHaveText('0.0%');

  // labels page: one QR image per part
  await page.getByTestId('print-labels').click();
  await page.getByTestId('labels-a4-24').click();
  await expect(page.getByTestId('labels-page')).toBeVisible();
  await expect(page.getByTestId('label-qr')).toHaveCount(total, { timeout: 20_000 });
  expect(await page.getByTestId('label-qr').first().getAttribute('src')).toMatch(/^data:image\/png;base64,/);
  await expect(page.getByTestId('label-sheet')).toHaveCount(Math.ceil(total / 24));
  await expect(page.getByTestId('labels-print')).toBeEnabled();
  await page.getByTestId('label-layout').getByRole('button', { name: /Roll/ }).click();
  await expect(page).toHaveURL(/layout=roll-62x29/);
  await expect(page.getByTestId('label-sheet')).toHaveCount(total);
  await page.getByTestId('labels-back').click();

  // pick a profile part waiting at cutting
  await expect(page.getByTestId('station-board')).toBeVisible();
  const chip = page.getByTestId('board-cutting').locator('[data-testid^="chip-"]').first();
  const code = ((await chip.getAttribute('data-testid')) ?? '').replace('chip-', '');
  expect(code).toMatch(/^[A-HJ-NP-Z2-9]{8}$/);

  // workstation: keyboard-wedge style scan (type + Enter)
  await page.getByRole('link', { name: 'Workstation' }).click();
  await page.getByTestId('station-cutting').click();
  await expect(page.getByTestId('scan-input')).toBeFocused();
  await page.getByTestId('scan-input').fill(code.toLowerCase());
  await page.keyboard.press('Enter');
  const panel = page.getByTestId('part-panel');
  await expect(panel.getByTestId('part-code')).toHaveText(code);
  await expect(page.getByTestId('camera-unsupported').or(page.getByTestId('camera-toggle'))).toBeVisible();
  await panel.getByTestId('action-start').click();
  await expect(panel).toContainText('in progress');
  await panel.getByTestId('action-complete').click();
  await expect(panel.getByTestId('part-current-station')).toContainText('Machining');
  await expect(page.getByTestId('station-mismatch')).toContainText('Machining');
  await expect(page.getByTestId('recent-scans')).toContainText(code);
  // a wrong-station start is not offered
  await expect(panel.getByTestId('action-start')).toBeDisabled();

  // the order reflects the progress
  await page.getByRole('link', { name: 'Production' }).click();
  await expect(page.getByTestId('order-detail')).toBeVisible();
  await expect(page.getByTestId('board-machining-pending')).toContainText('1 waiting');

  // what the QR opens
  await page.goto(`/p/${code}`);
  const pp = page.getByTestId('part-page');
  await expect(pp.getByTestId('part-code')).toHaveText(code);
  await expect(pp.getByTestId('part-current-station')).toContainText('Machining');
  await expect(pp.getByTestId('event-timeline').locator('li')).toHaveCount(2);
  await expect(pp.getByTestId('action-start')).toBeEnabled();

  await page.goto('/p/ZZZZZZZZ');
  await expect(page.getByTestId('part-page')).toContainText('Unknown part code');
});

test('offline: block needs a note and unblocks back', async ({ page }) => {
  await openOffline(page);
  await calcRun(page);
  await createWorkOrder(page);
  await page.getByRole('tab', { name: /Parts/ }).click();
  await page.getByTestId('parts-filter-kind').selectOption('glass');
  await page.locator('[data-testid^="part-row-"]').first().click();
  const drawer = page.getByTestId('part-drawer');
  await drawer.getByTestId('action-block').click();
  await expect(drawer.getByTestId('action-confirm')).toBeDisabled();
  await drawer.getByTestId('action-note-text').fill('Edge chipped on delivery');
  await drawer.getByTestId('action-confirm').click();
  await expect(drawer).toContainText('blocked');
  await expect(drawer.getByTestId('event-timeline')).toContainText('Edge chipped on delivery');
  await expect(page.getByTestId('kpi-blocked')).toContainText('1');
  await drawer.getByTestId('action-unblock').click();
  await expect(page.getByTestId('kpi-blocked')).toContainText('0');
});

test('offline: generate purchase orders from a calc, edit, send, receive', async ({ page }) => {
  page.on('dialog', (d) => void d.accept());
  await openOffline(page);
  await calcRun(page);
  await page.getByRole('link', { name: 'Purchasing' }).click();
  await page.getByTestId('generate-po').click();
  const dlg = page.getByTestId('generate-po-dialog');
  await dlg.locator('[data-testid^="po-run-"]').first().check();
  await dlg.getByTestId('create-po').click();
  const detail = page.getByTestId('po-detail');
  await expect(detail).toBeVisible();
  await expect(page.getByTestId('po-demo-banner')).toContainText('Demo prices — not a commercial offer');
  await expect(page.getByTestId('po-list').locator('button')).toHaveCount(3); // profiles, glass, accessories
  const before = await page.getByTestId('po-total').innerText();
  await page.getByTestId('po-supplier').fill('Demo Extrusions Ltd');
  const q0 = page.getByTestId('po-qty-0');
  await q0.fill(String(Number(await q0.inputValue()) + 2));
  await expect(page.getByTestId('po-total')).not.toHaveText(before);
  await page.getByTestId('po-save').click();
  await expect(page.getByTestId('toaster')).toContainText('saved');
  await page.getByTestId('po-mark-sent').click();
  await expect(detail).toContainText('sent');
  const csv = page.waitForEvent('download');
  await page.getByTestId('po-csv').click();
  expect((await csv).suggestedFilename()).toMatch(/^PO-\d{4}-0001\.csv$/);
  await page.getByTestId('po-mark-received').click();
  await expect(page.getByTestId('toaster')).toContainText('added to inventory');
  await expect(page.getByTestId('po-detail')).toContainText('received');
  await page.getByRole('link', { name: 'Inventory' }).click();
  await expect(page.getByTestId('inventory-table')).toContainText('purchase #');
});

test('offline: export DXF from the editor; design checks shown with demo tag', async ({ page }) => {
  await openOffline(page, '/editor/11');
  await expect(page.getByTestId('cad-canvas')).toBeVisible();
  // E01 is anchored only at 0 and 4200 mm → unsupported span above the demo threshold
  await expect(page.getByTestId('editor-issues')).toContainText('MULLION_SPAN_HIGH');
  await expect(page.getByTestId('editor-issues').getByTestId('design-check-tag').first()).toHaveText('Design check (demo threshold)');
  await page.getByTestId('export-button').click();
  const dl = page.waitForEvent('download');
  await page.getByTestId('export-dxf').click();
  const d = await dl;
  expect(d.suggestedFilename()).toMatch(/\.dxf$/);
  const text = await readFile((await d.path())!, 'utf8');
  expect(text.startsWith('0\nSECTION\n2\nHEADER\n9\n$ACADVER\n1\nAC1009\n')).toBe(true);
  expect(text).toContain('FOS-MULLION');
  expect(text.trimEnd().endsWith('0\nEOF')).toBe(true);
});

test.describe('phone viewport (390×844)', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  const noHorizontalOverflow = async (page: Page) => {
    const { sw, cw } = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
    expect(sw).toBeLessThanOrEqual(cw);
  };

  test('start screen fits without horizontal overflow; app shell uses a drawer', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => {
      localStorage.clear();
      sessionStorage.clear();
    });
    await page.goto('/');
    const btn = page.getByTestId('continue-offline').or(page.getByTestId('login-offline'));
    await expect(btn.first()).toBeVisible({ timeout: 20_000 });
    await noHorizontalOverflow(page);
    // every element of the start/login card is inside the viewport
    const outside = await page.evaluate(() =>
      [...document.querySelectorAll('[data-testid="startup-screen"] *, [data-testid="login-screen"] *')]
        .map((el) => el.getBoundingClientRect())
        .filter((r) => r.width > 0 && (r.left < -0.5 || r.right > window.innerWidth + 0.5)).length,
    );
    expect(outside).toBe(0);
    const box = (await btn.first().boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(16 - 0.5);
    expect(box.x + box.width).toBeLessThanOrEqual(390 - 16 + 0.5);

    await btn.first().click();
    await expect(page.getByTestId('nav-menu')).toBeVisible();
    await noHorizontalOverflow(page);
    await page.getByTestId('nav-menu').click();
    await expect(page.getByTestId('nav-drawer')).toBeVisible();
    await page.getByTestId('nav-drawer').getByRole('link', { name: 'Workstation' }).click();
    await expect(page.getByTestId('nav-drawer')).toBeHidden();
    await expect(page.getByTestId('scan-input')).toBeVisible();
    await noHorizontalOverflow(page);
    expect(await page.getByTestId('station-page').evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(0);
    await page.getByTestId('scan-input').fill('NOPE2345');
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('station-part')).toContainText('Part not found');
    expect(await page.getByTestId('station-page').evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(0);
    await page.goto('/editor/11');
    await expect(page.getByTestId('editor-small-screen')).toBeVisible();
    await noHorizontalOverflow(page);
  });
});
