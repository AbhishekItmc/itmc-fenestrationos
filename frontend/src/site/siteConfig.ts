/**
 * ITMC FenestrationOS — public website configuration.
 *
 * EVERYTHING the owner is expected to edit lives in this one file: contact details, plan names / prices / contents,
 * the pricing FAQ and the About page facts. Optional values left empty ('' or null) are simply not rendered,
 * so the site never shows placeholder text to visitors.
 */

export type SolutionKey = 'design-calculation' | 'cutting-nesting' | 'production-tracking' | 'purchasing-quotes';

export interface Plan {
  id: 'starter' | 'professional' | 'enterprise';
  name: string;
  tagline: string;
  /**
   * Price shown on the pricing page. `null` renders "On request".
   * EDITABLE: set e.g. { amount: '₹ 4,999', period: 'per user / month' } once commercial terms are fixed.
   */
  price: { amount: string; period: string } | null;
  /** Short list on the plan card. EDITABLE. */
  highlights: string[];
  /** Visually emphasised card (at most one). */
  featured?: boolean;
  cta: string;
}

/** Cell of the pricing comparison table: true = included, false = not included, string = note. */
export type Cell = boolean | string;

export interface ComparisonRow {
  feature: string;
  values: Record<Plan['id'], Cell>;
}

export const siteConfig = {
  productName: 'ITMC FenestrationOS',
  shortName: 'FenestrationOS',
  companyName: 'ITMC Systems',
  /** Public site URL (used for Open Graph tags in index.html too — keep both in sync). */
  siteUrl: 'https://itmc-fenestrationos.vercel.app',

  // ---------------------------------------------------------------- contact — EDITABLE
  /** PLACEHOLDER — replace with the real sales / info address. Used in the footer, contact page and mailto fallback. */
  contactEmail: 'info@itmcsystems.com',
  /** Optional, rendered on the contact page only when filled. e.g. '+91 …' */
  contactPhone: '',
  /** Optional postal address (one line per entry), rendered only when non-empty. */
  contactAddress: [] as string[],

  // ---------------------------------------------------------------- about — EDITABLE
  about: {
    /** Rendered as the About page lead paragraph. Generic default; rewrite in ITMC's own words. */
    mission:
      'We build software for the people who design, engineer and manufacture façades and fenestration systems — so that drawings, calculations, cut lists, production and purchasing work from one consistent set of data instead of disconnected spreadsheets.',
    /**
     * Optional company facts. Each one renders only when filled; leave '' to hide it.
     * Examples of what to put here: founded: '[Founded in ____]', headquarters: '[City, Country]', team: '[__ people]'.
     */
    facts: {
      founded: '',
      headquarters: '',
      team: '',
    },
    /** Optional longer story paragraphs (rendered only when the array is non-empty). */
    story: [] as string[],
  },

  // ---------------------------------------------------------------- pricing — EDITABLE
  /** Note under the plan cards. */
  pricingNote:
    'Pricing depends on the modules, the number of users and the deployment model (cloud or on-premise). Tell us about your workflow and we will send a quotation.',
  plans: [
    {
      id: 'starter',
      name: 'Starter',
      tagline: 'Design, calculate and optimise cutting for a small engineering team.',
      price: null, // EDITABLE: e.g. { amount: '…', period: 'per user / month' }
      highlights: ['Elevation CAD editor', 'Engineering calculation & BOM', '1D cutting and 2D nesting', 'PDF and Excel reports'],
      cta: 'Request pricing',
    },
    {
      id: 'professional',
      name: 'Professional',
      tagline: 'The full workflow from drawing to dispatched part.',
      price: null, // EDITABLE
      highlights: ['Everything in Starter', 'Production work orders & QR part tracking', 'Purchasing from the BOM', 'Quotations', 'Inventory & offcut reuse'],
      featured: true,
      cta: 'Request pricing',
    },
    {
      id: 'enterprise',
      name: 'Enterprise',
      tagline: 'Your systems, your rules, your infrastructure.',
      price: null, // EDITABLE
      highlights: ['Everything in Professional', 'Catalogue & rule-set configuration for your systems', 'On-premise or private-cloud deployment', 'Onboarding for engineering and shop-floor teams'],
      cta: 'Talk to us',
    },
  ] as Plan[],

  /** Feature comparison table. EDITABLE: align with the commercial offer. */
  comparison: [
    { feature: 'Elevation CAD editor & DXF export', values: { starter: true, professional: true, enterprise: true } },
    { feature: 'Engineering calculation with traceable formulas', values: { starter: true, professional: true, enterprise: true } },
    { feature: 'Design checks (glass weight, spans, field size)', values: { starter: true, professional: true, enterprise: true } },
    { feature: '1D profile cutting optimisation', values: { starter: true, professional: true, enterprise: true } },
    { feature: '2D glass & sheet nesting', values: { starter: true, professional: true, enterprise: true } },
    { feature: 'Inventory & reusable offcuts', values: { starter: false, professional: true, enterprise: true } },
    { feature: 'Production work orders & QR labels', values: { starter: false, professional: true, enterprise: true } },
    { feature: 'Workstation scanning (phone or scanner)', values: { starter: false, professional: true, enterprise: true } },
    { feature: 'Purchase orders from the BOM', values: { starter: false, professional: true, enterprise: true } },
    { feature: 'Quotations', values: { starter: false, professional: true, enterprise: true } },
    { feature: 'Role-based access & audit trail', values: { starter: true, professional: true, enterprise: true } },
    { feature: 'Catalogue & calculation rules configured for your systems', values: { starter: 'Add-on', professional: 'Add-on', enterprise: true } },
    { feature: 'Deployment', values: { starter: 'Cloud', professional: 'Cloud', enterprise: 'Cloud or on-premise' } },
  ] as ComparisonRow[],

  /** Pricing FAQ. EDITABLE. Keep answers factual. */
  faq: [
    {
      q: 'Is a profile catalogue included?',
      a: 'Catalogue data and calculation rules are configured per customer for the systems you actually fabricate. The demo uses an illustrative catalogue that is not manufacturer data.',
    },
    {
      q: 'Are the calculation results certified?',
      a: 'No software output replaces a qualified engineer. Results are labelled provisional until your rule set has been approved and has passed its reference test cases; only then are they marked validated.',
    },
    {
      q: 'Can we run it on our own servers?',
      a: 'Yes. FenestrationOS runs as a hosted cloud service or on your own infrastructure using the provided container setup with a PostgreSQL database.',
    },
    {
      q: 'Can we try it before talking to sales?',
      a: 'Yes. Open the app and choose offline demo mode: the editor, calculation and optimisers run in your browser with demo data, nothing is sent to a server.',
    },
    {
      q: 'Which roles are supported?',
      a: 'Admin, engineer, estimator, viewer and shop-floor operator. Every change is recorded in an audit trail.',
    },
  ],
};

/** Display string for a plan price ("On request" until an amount is configured). */
export function priceLabel(plan: Plan): { amount: string; period: string } {
  return plan.price ?? { amount: 'On request', period: '' };
}

/** Optional About facts that have a value, in display order. */
export function filledFacts(facts: Record<string, string>): { label: string; value: string }[] {
  const labels: Record<string, string> = { founded: 'Founded', headquarters: 'Headquarters', team: 'Team' };
  return Object.entries(facts)
    .filter(([, v]) => v.trim().length > 0)
    .map(([k, v]) => ({ label: labels[k] ?? k, value: v.trim() }));
}
