import { expect, test } from '@playwright/test';
import path from 'node:path';
import { openOffline } from './helpers';

const OUT = path.resolve(__dirname, '../../docs/screenshots');

test('screenshots: editor, cutting, nesting (1440×900)', async ({ page }) => {
  await openOffline(page, '/editor/11');
  await expect(page.getByTestId('cad-canvas')).toBeVisible();
  await page.getByTestId('mullion-2').click();
  await page.mouse.move(700, 450);
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}/editor.png` });

  await page.getByTestId('theme-toggle').click();
  await page.getByTestId('tree-b1-f1').click();
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${OUT}/editor-light.png` });
  await page.getByTestId('theme-toggle').click();

  await page.getByTestId('calculate').click();
  await expect(page.getByTestId('calc-drawer')).toBeVisible();
  await page.screenshot({ path: `${OUT}/calc-drawer.png` });

  await page.goto('/cutting');
  await page.getByTestId('load-demo-cutting').click();
  await page.getByTestId('run-cutting').click();
  await expect(page.getByTestId('cutting-results')).toContainText('VALIDATOR PASSED');
  await page.waitForTimeout(4000);
  await page.screenshot({ path: `${OUT}/cutting.png` });

  await page.goto('/nesting');
  await page.getByTestId('load-demo-nesting').click();
  await page.getByTestId('run-nesting').click();
  await expect(page.getByTestId('nesting-results')).toContainText('VALIDATOR PASSED');
  await page.waitForTimeout(4000);
  await page.screenshot({ path: `${OUT}/nesting.png` });
});
