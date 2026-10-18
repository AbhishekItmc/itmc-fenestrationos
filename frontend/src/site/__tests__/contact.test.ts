import { describe, expect, it, vi } from 'vitest';
import { buildMailto, EMPTY_FORM, interestFromQuery, leadPayload, looksAutomated, submitLead, validateLead, type LeadForm } from '../contact';
import { siteConfig } from '../siteConfig';

const good: LeadForm = {
  ...EMPTY_FORM,
  name: 'Asha Rao',
  company: 'Facade Works',
  email: 'asha@example.com',
  message: 'We fabricate unitised and stick systems.',
  interest: ['cutting-nesting'],
  consent: true,
};

const res = (status: number, body: unknown, type = 'application/json') =>
  new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers: { 'content-type': type } });

describe('contact form validation', () => {
  it('accepts a complete form', () => {
    expect(validateLead(good)).toEqual({});
  });

  it('requires name, company, e-mail, message and consent', () => {
    const e = validateLead(EMPTY_FORM);
    expect(Object.keys(e).sort()).toEqual(['company', 'consent', 'email', 'message', 'name']);
  });

  it('rejects malformed e-mail, phone and too-short messages', () => {
    expect(validateLead({ ...good, email: 'asha@example' }).email).toBeTruthy();
    expect(validateLead({ ...good, email: 'a b@example.com' }).email).toBeTruthy();
    expect(validateLead({ ...good, phone: 'call me maybe' }).phone).toBeTruthy();
    expect(validateLead({ ...good, phone: '+91 (22) 1234-5678' }).phone).toBeUndefined();
    expect(validateLead({ ...good, message: 'hi' }).message).toBeTruthy();
    expect(validateLead({ ...good, name: 'x'.repeat(201) }).name).toBeTruthy();
    expect(validateLead({ ...good, consent: false }).consent).toBeTruthy();
  });
});

describe('spam heuristics', () => {
  it('flags a filled honeypot or a too-fast submission', () => {
    expect(looksAutomated({ website: '' }, 9000)).toBe(false);
    expect(looksAutomated({ website: 'http://spam.example' }, 9000)).toBe(true);
    expect(looksAutomated({ website: '' }, 800)).toBe(true);
  });

  it('sends the honeypot and timing to the API for its own check', () => {
    const p = leadPayload({ ...good, phone: '  ' }, 4321.6, '/contact?plan=starter');
    expect(p).toMatchObject({ website: '', elapsed_ms: 4322, phone: null, country: null, source_page: '/contact?plan=starter', interest: ['cutting-nesting'] });
    expect(p).not.toHaveProperty('consent');
  });
});

describe('submitLead', () => {
  const payload = leadPayload(good, 5000, '/contact');

  it('treats 201 and 202 as success', async () => {
    expect(await submitLead(payload, vi.fn().mockResolvedValue(res(201, { ok: true })))).toEqual({ kind: 'ok' });
    expect(await submitLead(payload, vi.fn().mockResolvedValue(res(202, { ok: true })))).toEqual({ kind: 'ok' });
  });

  it('reports validation errors and rate limiting', async () => {
    const r = await submitLead(payload, vi.fn().mockResolvedValue(res(422, { detail: { code: 'VALIDATION_ERROR', message: 'bad', issues: [{ loc: ['body', 'email'], msg: 'invalid e-mail address' }] } })));
    expect(r).toEqual({ kind: 'invalid', message: 'email: invalid e-mail address' });
    expect(await submitLead(payload, vi.fn().mockResolvedValue(res(429, { detail: {} })))).toEqual({ kind: 'rate-limited' });
  });

  it('falls back to e-mail when the API cannot be reached', async () => {
    expect(await submitLead(payload, vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))).toEqual({ kind: 'unreachable' });
    expect(await submitLead(payload, vi.fn().mockResolvedValue(res(502, 'Bad gateway', 'text/plain')))).toEqual({ kind: 'unreachable' });
    // a platform 404 page (API service missing) is HTML, not our JSON
    expect(await submitLead(payload, vi.fn().mockResolvedValue(res(201, '<html></html>', 'text/html')))).toEqual({ kind: 'unreachable' });
  });

  it('posts JSON to /api/v1/leads', async () => {
    const f = vi.fn().mockResolvedValue(res(201, { ok: true }));
    await submitLead(payload, f);
    expect(f).toHaveBeenCalledWith('/api/v1/leads', expect.objectContaining({ method: 'POST' }));
    expect(JSON.parse(f.mock.calls[0][1].body)).toMatchObject({ email: 'asha@example.com', elapsed_ms: 5000 });
  });
});

describe('mailto fallback', () => {
  it('prefills subject and body with the form content', () => {
    const m = buildMailto({ ...good, phone: '+91 22 1234 5678' });
    expect(m.startsWith(`mailto:${siteConfig.contactEmail}?subject=`)).toBe(true);
    const u = new URL(m);
    expect(u.searchParams.get('subject')).toBe('Demo request — Facade Works');
    const body = u.searchParams.get('body')!;
    expect(body).toContain('We fabricate unitised and stick systems.');
    expect(body).toContain('E-mail: asha@example.com');
    expect(body).toContain('Phone: +91 22 1234 5678');
    expect(body).toContain('Interested in: Cutting & Nesting');
    expect(body).not.toContain('Country:');
  });

  it('reads interests from the query string', () => {
    expect(interestFromQuery('?interest=cutting-nesting,bogus,production-tracking')).toEqual(['cutting-nesting', 'production-tracking']);
    expect(interestFromQuery('')).toEqual([]);
  });
});
