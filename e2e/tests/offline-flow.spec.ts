import { expect, test } from '@playwright/test';
import { mullionCount, openOffline } from './helpers';

test('offline: wizard → mullion → undo/redo → fill → calculate → send to cutting → optimise', async ({ page }) => {
  await openOffline(page);
  await expect(page.getByTestId('projects-table')).toContainText('DEMO-TWR-01');

  // --- create an elevation with the wizard
  await page.getByRole('link', { name: 'Elevation CAD' }).click();
  await page.getByTestId('new-elevation').click();
  const wiz = page.getByTestId('new-elevation-wizard');
  await expect(wiz).toBeVisible();
  await wiz.getByTestId('wizard-name').fill('E2E — test elevation');
  await wiz.getByTestId('wizard-bays').fill('3');
  await wiz.getByTestId('wizard-rows').fill('2');
  await wiz.getByTestId('wizard-create').click();
  await expect(page.getByTestId('cad-canvas')).toBeVisible();
  await expect(page.getByTestId('elevation-tree')).toContainText('E2E — test elevation');
  expect(await mullionCount(page)).toBe(4);

  // --- add a mullion in the middle of bay 1
  await page.getByTestId('tool-mullion').click();
  const field = page.getByTestId('field-b0-f0');
  const box = (await field.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await expect(page.getByTestId('ghost-mullion')).toBeVisible();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect.poll(() => mullionCount(page)).toBe(5);
  await expect(page.getByTestId('prop-mullion-x')).toHaveValue('750');

  // --- undo / redo (toolbar and keyboard)
  await page.getByTestId('tool-select').click();
  await page.getByTestId('undo').click();
  await expect.poll(() => mullionCount(page)).toBe(4);
  await page.getByTestId('redo').click();
  await expect.poll(() => mullionCount(page)).toBe(5);
  await page.keyboard.press('Control+z');
  await expect.poll(() => mullionCount(page)).toBe(4);
  await page.keyboard.press('Control+y');
  await expect.poll(() => mullionCount(page)).toBe(5);

  // --- set fill of a field to spandrel
  await page.getByTestId('tree-b2-f0').click();
  await page.getByTestId('prop-fill-type').getByRole('button', { name: 'Spandrel', exact: true }).click();
  await expect(page.getByTestId('tree-b2-f0')).toContainText('spandrel');

  // --- calculate
  await page.getByTestId('calculate').click();
  const drawer = page.getByTestId('calc-drawer');
  await expect(drawer).toBeVisible();
  await expect(drawer.getByTestId('provisional-banner')).toBeVisible();
  await expect(drawer).toContainText('VALIDATOR PASSED');
  await expect(drawer.getByTestId('cut-list')).toContainText('DEMO-CW50-M150');

  // --- send mullion profile to 1D cutting and optimise
  await drawer.getByTestId('send-to-cutting').click();
  await expect(page.getByTestId('cutting-page')).toBeVisible();
  await expect(page.getByTestId('pieces-table').locator('input').first()).toHaveValue('M1');
  await page.getByTestId('run-cutting').click();
  const results = page.getByTestId('cutting-results');
  await expect(results).toContainText('VALIDATOR PASSED');
  await expect(results.getByTestId('bar-pattern').first()).toBeVisible();
  await expect(results).toContainText('Offline demo engine — heuristic');
  await expect(page.getByTestId('kpi-status')).toContainText(/OPTIMAL_PROVEN|FEASIBLE_HEURISTIC/);
});

test('offline: 1D demo dataset, save job and return offcuts to inventory', async ({ page }) => {
  await openOffline(page, '/cutting');
  await page.getByTestId('load-demo-cutting').click();
  await page.getByTestId('run-cutting').click();
  await expect(page.getByTestId('cutting-results')).toContainText('VALIDATOR PASSED');
  await page.getByTestId('save-cutting-job').click();
  await expect(page.getByTestId('save-cutting-job')).toContainText('Saved');
  await page.getByTestId('return-offcuts').click();
  await expect(page.getByTestId('toaster')).toContainText('added to inventory');
  await page.getByRole('link', { name: 'Inventory' }).click();
  await page.getByTestId('residual-filter').getByRole('button', { name: 'Residuals only' }).click();
  await expect(page.getByTestId('inventory-table')).toContainText('cutting #');
});

test('offline: 2D nesting demo run', async ({ page }) => {
  await openOffline(page, '/nesting');
  await page.getByTestId('load-demo-nesting').click();
  await page.getByTestId('run-nesting').click();
  const res = page.getByTestId('nesting-results');
  await expect(res).toContainText('VALIDATOR PASSED');
  await expect(res.getByTestId('sheet-layout').first()).toBeVisible();
  await expect(page.getByTestId('nesting-kpis')).toContainText('Sheets used');
});

test('offline: import validation rejects a malformed elevation JSON', async ({ page }) => {
  await openOffline(page, '/editor/11');
  await expect(page.getByTestId('cad-canvas')).toBeVisible();
  await page.getByTestId('import-file').setInputFiles({ name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ width: -5, mullions: 'x' })) });
  await expect(page.getByRole('dialog')).toContainText('Import rejected');
});
