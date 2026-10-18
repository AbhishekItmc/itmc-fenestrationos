import { expect, test, type Page } from '@playwright/test';

/** Public product website: works without the API, navigation, responsive layout, demo-request form. */

const SOLUTIONS = ['design-calculation', 'cutting-nesting', 'production-tracking', 'purchasing-quotes'];

async function blockApi(page: Page): Promise<string[]> {
  const hits: string[] = [];
  await page.route('**/api/**', (route) => {
    hits.push(route.request().url());
    return route.abort('connectionrefused');
  });
  return hits;
}

async function noHorizontalOverflow(page: Page) {
  const { sw, cw } = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
  expect(sw, 'page must not scroll horizontally').toBeLessThanOrEqual(cw);
}

test('home renders without the API and never calls it', async ({ page }) => {
  const hits = await blockApi(page);
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('From elevation drawing to dispatched part');
  await expect(page).toHaveTitle(/ITMC FenestrationOS/);
  await expect(page.locator('meta[name="description"]')).toHaveAttribute('content', /curtain-wall/);
  await expect(page.getByTestId('site-header').getByRole('link', { name: 'Log in' })).toHaveAttribute('href', '/app');
  await expect(page.getByTestId('site-demo')).toHaveAttribute('href', '/contact');
  for (const k of SOLUTIONS) await expect(page.getByTestId(`card-${k}`)).toBeVisible();
  await expect(page.getByTestId('footer-email')).toHaveText('info@itmcsystems.com');
  // the hero image is a real product screenshot with alt text
  const hero = page.getByTestId('home-hero').locator('img').first();
  await expect(hero).toHaveAttribute('alt', /elevation editor/i);
  expect(await hero.evaluate((i: HTMLImageElement) => i.complete && i.naturalWidth > 0)).toBe(true);
  // the application bundle and its startup check are not loaded on the website
  await expect(page.getByTestId('startup-screen')).toHaveCount(0);
  expect(hits).toEqual([]);
});

test('navigate to every solution page from the header menu', async ({ page }) => {
  await blockApi(page);
  await page.goto('/');
  for (const k of SOLUTIONS) {
    await page.getByTestId('nav-solutions').click();
    await page.getByTestId(`menu-${k}`).click();
    await expect(page).toHaveURL(new RegExp(`/solutions/${k}$`));
    const art = page.getByTestId(`solution-${k}`);
    await expect(art.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(art.getByRole('heading', { name: 'From input to result in four steps.' })).toBeVisible();
    await expect(page).toHaveTitle(/· ITMC FenestrationOS$/);
  }
  // overview and the other pages
  await page.getByTestId('site-header').getByRole('link', { name: 'Pricing' }).click();
  await expect(page.getByTestId('plans').locator('> li')).toHaveCount(3);
  await expect(page.getByTestId('price-professional')).toHaveText('On request');
  await page.getByTestId('site-header').getByRole('link', { name: 'About' }).click();
  await expect(page.getByTestId('about-mission')).toBeVisible();
  await page.getByTestId('site-footer').getByRole('link', { name: 'Privacy' }).click();
  await expect(page.getByTestId('legal-placeholder')).toContainText('to be provided by ITMC');
  // deep link + unknown public path
  await page.goto('/solutions/cutting-nesting');
  await expect(page.getByTestId('solution-cutting-nesting')).toBeVisible();
  await page.goto('/solutions/not-a-solution');
  await expect(page.getByTestId('not-found')).toBeVisible();
  await page.goto('/no/such/page');
  await expect(page.getByTestId('not-found')).toBeVisible();
});

test('old application URLs redirect to /app', async ({ page }) => {
  await page.goto('/cutting');
  await expect(page).toHaveURL(/\/app\/cutting$/);
  await page.goto('/production/1/labels?layout=a4-8');
  await expect(page).toHaveURL(/\/app\/production\/1\/labels\?layout=a4-8$/);
  await page.goto('/login');
  await expect(page).toHaveURL(/\/app$/);
});

test('contact form: validation, then e-mail fallback when the API is down', async ({ page }) => {
  await blockApi(page);
  await page.goto('/contact?interest=cutting-nesting');
  await expect(page.getByTestId('interest-cutting-nesting')).toBeChecked();
  await page.getByTestId('contact-submit').click();
  await expect(page.getByTestId('error-f-name')).toBeVisible();
  await expect(page.getByTestId('error-f-email')).toBeVisible();
  await expect(page.getByTestId('error-f-consent')).toBeVisible();
  await expect(page.getByTestId('contact-name')).toBeFocused();
  // the honeypot is not visible to people
  await expect(page.getByTestId('contact-website')).not.toBeInViewport();

  await page.getByTestId('contact-name').fill('Asha Rao');
  await page.getByTestId('contact-company').fill('Facade Works');
  await page.getByTestId('contact-email').fill('not-an-email');
  await page.getByTestId('contact-message').fill('We fabricate stick curtain walls and want to see cutting.');
  await page.getByTestId('contact-consent').check();
  await page.getByTestId('contact-submit').click();
  await expect(page.getByTestId('error-f-email')).toContainText('valid e-mail');
  await page.getByTestId('contact-email').fill('asha@example.com');
  await page.waitForTimeout(2100); // humans take longer than the anti-bot threshold
  await page.getByTestId('contact-submit').click();
  const fb = page.getByTestId('contact-fallback');
  await expect(fb).toBeVisible();
  const href = (await page.getByTestId('contact-mailto').getAttribute('href'))!;
  expect(href.startsWith('mailto:info@itmcsystems.com?subject=')).toBe(true);
  const body = new URL(href).searchParams.get('body')!;
  expect(body).toContain('E-mail: asha@example.com');
  expect(body).toContain('Interested in: Cutting & Nesting');
});

test('contact form: success state when the API accepts the request', async ({ page }) => {
  let posted: Record<string, unknown> | null = null;
  await page.route('**/api/v1/leads', async (route) => {
    posted = route.request().postDataJSON();
    await route.fulfill({ status: 201, contentType: 'application/json', body: '{"ok":true}' });
  });
  await page.goto('/contact?plan=enterprise');
  await page.getByTestId('contact-name').fill('Asha Rao');
  await page.getByTestId('contact-company').fill('Facade Works');
  await page.getByTestId('contact-email').fill('asha@example.com');
  await page.getByTestId('contact-message').fill('Please send pricing for the enterprise plan.');
  await page.getByTestId('contact-consent').check();
  await page.waitForTimeout(2100);
  await page.getByTestId('contact-submit').click();
  await expect(page.getByTestId('contact-success')).toBeVisible();
  expect(posted).toMatchObject({ email: 'asha@example.com', website: '', source_page: '/contact?plan=enterprise' });
  expect((posted as unknown as { elapsed_ms: number }).elapsed_ms).toBeGreaterThanOrEqual(2000);
});

test.describe('phone viewport (390×844)', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test('home, pricing and contact fit without horizontal overflow; mobile menu works', async ({ page }) => {
    await blockApi(page);
    for (const path of ['/', '/pricing', '/contact', '/solutions', '/solutions/production-tracking', '/about']) {
      await page.goto(path);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await noHorizontalOverflow(page);
    }
    await page.goto('/');
    await expect(page.getByTestId('nav-solutions')).toBeHidden();
    await page.getByTestId('site-menu-toggle').click();
    const menu = page.getByTestId('mobile-menu');
    await expect(menu).toBeVisible();
    await noHorizontalOverflow(page);
    await menu.getByRole('link', { name: 'Production Tracking' }).click();
    await expect(page).toHaveURL(/\/solutions\/production-tracking$/);
    await expect(menu).toBeHidden();
  });
});
