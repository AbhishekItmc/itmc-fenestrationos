/** Demo-request form logic (pure, unit-tested): validation, spam heuristics, submission and the mailto fallback. */
import { siteConfig, type SolutionKey } from './siteConfig';

export const SOLUTION_KEYS: SolutionKey[] = ['design-calculation', 'cutting-nesting', 'production-tracking', 'purchasing-quotes'];

export interface LeadForm {
  name: string;
  company: string;
  email: string;
  phone: string;
  country: string;
  message: string;
  interest: SolutionKey[];
  consent: boolean;
  /** honeypot — hidden from people, bots tend to fill it */
  website: string;
}

export const EMPTY_FORM: LeadForm = { name: '', company: '', email: '', phone: '', country: '', message: '', interest: [], consent: false, website: '' };

/** Same rule as the API (backend/app/schemas: _EMAIL). */
const EMAIL = /^[^@\s]{1,64}@[^@\s]+\.[^@\s]{2,}$/;
const PHONE = /^[0-9+()\-.\s/]{5,50}$/;
/** Forms submitted faster than this are treated as automated by the API (it answers 202 and drops them). */
export const MIN_FORM_MS = 2000;

export type LeadErrors = Partial<Record<'name' | 'company' | 'email' | 'phone' | 'country' | 'message' | 'consent', string>>;

export function validateLead(f: LeadForm): LeadErrors {
  const e: LeadErrors = {};
  if (!f.name.trim()) e.name = 'Please enter your name.';
  else if (f.name.trim().length > 200) e.name = 'Please use at most 200 characters.';
  if (!f.company.trim()) e.company = 'Please enter your company.';
  else if (f.company.trim().length > 200) e.company = 'Please use at most 200 characters.';
  const email = f.email.trim();
  if (!email) e.email = 'Please enter your work e-mail.';
  else if (!EMAIL.test(email) || email.length > 254) e.email = 'Please enter a valid e-mail address.';
  if (f.phone.trim() && !PHONE.test(f.phone.trim())) e.phone = 'Please enter a valid phone number.';
  if (f.country.trim().length > 100) e.country = 'Please use at most 100 characters.';
  const msg = f.message.trim();
  if (msg.length < 10) e.message = 'Please tell us a little about your project (at least 10 characters).';
  else if (msg.length > 5000) e.message = 'Please keep the message under 5000 characters.';
  if (!f.consent) e.consent = 'Please confirm that we may contact you about your request.';
  return e;
}

/** True when the submission looks automated: honeypot filled or the form was completed implausibly fast. */
export function looksAutomated(f: Pick<LeadForm, 'website'>, elapsedMs: number): boolean {
  return f.website.trim().length > 0 || elapsedMs < MIN_FORM_MS;
}

export function leadPayload(f: LeadForm, elapsedMs: number, sourcePage: string) {
  return {
    name: f.name.trim(),
    company: f.company.trim(),
    email: f.email.trim(),
    phone: f.phone.trim() || null,
    country: f.country.trim() || null,
    message: f.message.trim(),
    interest: f.interest,
    source_page: sourcePage.slice(0, 200),
    website: f.website,
    elapsed_ms: Math.max(0, Math.round(elapsedMs)),
  };
}

export type SubmitResult = { kind: 'ok' } | { kind: 'invalid'; message: string } | { kind: 'rate-limited' } | { kind: 'unreachable' };

/**
 * POST /api/v1/leads. 201 (stored) and 202 (silently dropped as automated) are both success for the visitor.
 * Anything that is not a JSON answer from our API (network error, proxy / platform error page, 5xx) → 'unreachable',
 * which shows the e-mail fallback.
 */
export async function submitLead(payload: ReturnType<typeof leadPayload>, fetchImpl: typeof fetch = fetch): Promise<SubmitResult> {
  let res: Response;
  try {
    res = await fetchImpl('/api/v1/leads', { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(payload) });
  } catch {
    return { kind: 'unreachable' };
  }
  const json = (res.headers.get('content-type') ?? '').includes('application/json');
  if ((res.status === 201 || res.status === 202) && json) return { kind: 'ok' };
  if (res.status === 429 && json) return { kind: 'rate-limited' };
  if (res.status === 422 && json) {
    let message = 'Some fields are not valid. Please check the form.';
    try {
      const body = (await res.json()) as { detail?: { message?: string; issues?: { msg?: string; loc?: unknown[] }[] } };
      const first = body.detail?.issues?.[0];
      if (first?.msg) message = `${String(first.loc?.slice(-1)[0] ?? 'Field')}: ${first.msg}`;
      else if (body.detail?.message) message = body.detail.message;
    } catch {
      /* keep the generic text */
    }
    return { kind: 'invalid', message };
  }
  return { kind: 'unreachable' };
}

const INTEREST_LABEL: Record<SolutionKey, string> = {
  'design-calculation': 'Design & Calculation',
  'cutting-nesting': 'Cutting & Nesting',
  'production-tracking': 'Production Tracking',
  'purchasing-quotes': 'Purchasing & Quotes',
};
export const interestLabel = (k: SolutionKey) => INTEREST_LABEL[k];

/** Prefilled mailto: link with everything the visitor typed (used when the API cannot be reached). */
export function buildMailto(f: LeadForm, to = siteConfig.contactEmail): string {
  const subject = `Demo request${f.company.trim() ? ` — ${f.company.trim()}` : ''}`;
  const details: [string, string][] = [
    ['Name', f.name.trim()],
    ['Company', f.company.trim()],
    ['E-mail', f.email.trim()],
    ['Phone', f.phone.trim()],
    ['Country', f.country.trim()],
    ['Interested in', f.interest.map(interestLabel).join(', ')],
  ];
  const body = [f.message.trim(), '', ...details.filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`)].join('\n');
  return `mailto:${to}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

/** Interest keys from a query string (?interest=cutting-nesting,production-tracking). Unknown keys are ignored. */
export function interestFromQuery(search: string): SolutionKey[] {
  const raw = new URLSearchParams(search).get('interest') ?? '';
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter((s): s is SolutionKey => (SOLUTION_KEYS as string[]).includes(s));
}
