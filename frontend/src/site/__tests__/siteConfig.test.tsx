import { renderToString } from 'react-dom/server';
import { StaticRouter } from 'react-router-dom/server';
import { afterEach, describe, expect, it } from 'vitest';
import AboutPage from '../pages/AboutPage';
import PricingPage from '../pages/PricingPage';
import { filledFacts, priceLabel, siteConfig } from '../siteConfig';

const render = (el: React.ReactElement, path = '/') => renderToString(<StaticRouter location={path}>{el}</StaticRouter>);
const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ');

describe('pricing page renders from siteConfig', () => {
  const original = siteConfig.plans.map((p) => p.price);
  afterEach(() => siteConfig.plans.forEach((p, i) => (p.price = original[i])));

  it('shows three plans, "On request" by default, comparison rows and FAQ', () => {
    expect(siteConfig.plans.map((p) => p.name)).toEqual(['Starter', 'Professional', 'Enterprise']);
    const html = render(<PricingPage />, '/pricing');
    const t = text(html);
    for (const p of siteConfig.plans) {
      expect(html).toContain(`data-testid="plan-${p.id}"`);
      expect(t).toContain(p.name);
      for (const h of p.highlights) expect(t).toContain(h);
    }
    expect(t.match(/On request/g)?.length).toBe(3);
    for (const r of siteConfig.comparison) expect(t).toContain(r.feature);
    for (const f of siteConfig.faq) expect(t).toContain(f.q);
    expect(html).toContain('/contact?plan=professional');
  });

  it('shows a configured amount instead of "On request"', () => {
    siteConfig.plans[1].price = { amount: 'USD 99', period: 'per user / month' };
    const t = text(render(<PricingPage />, '/pricing'));
    expect(t).toContain('USD 99');
    expect(t).toContain('per user / month');
    expect(t.match(/On request/g)?.length).toBe(2);
    expect(priceLabel(siteConfig.plans[0])).toEqual({ amount: 'On request', period: '' });
  });
});

describe('about page optional facts', () => {
  afterEach(() => {
    siteConfig.about.facts.founded = '';
    siteConfig.about.facts.headquarters = '';
  });

  it('renders no facts block (and no placeholders) while the values are empty', () => {
    const html = render(<AboutPage />, '/about');
    expect(html).not.toContain('about-facts');
    expect(text(html)).not.toMatch(/\[[^\]]*_{2,}/); // no '[Founded in ____]'-style placeholders
    expect(text(html)).toContain(siteConfig.about.mission);
  });

  it('renders only the facts that are filled', () => {
    siteConfig.about.facts.founded = '2019';
    expect(filledFacts(siteConfig.about.facts)).toEqual([{ label: 'Founded', value: '2019' }]);
    const t = text(render(<AboutPage />, '/about'));
    expect(t).toContain('Founded 2019');
    expect(t).not.toContain('Headquarters');
  });
});
