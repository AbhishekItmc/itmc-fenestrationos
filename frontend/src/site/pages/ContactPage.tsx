import clsx from 'clsx';
import { AlertTriangle, ArrowRight, CheckCircle2, Loader2, Mail } from 'lucide-react';
import { useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { buildMailto, EMPTY_FORM, interestFromQuery, interestLabel, leadPayload, looksAutomated, SOLUTION_KEYS, submitLead, validateLead, type LeadErrors, type LeadForm } from '../contact';
import { siteConfig } from '../siteConfig';
import { useDocumentMeta } from '../useDocumentMeta';
import { Container, Eyebrow } from '../ui';

const inputCls =
  'block w-full rounded-md border border-line-strong bg-bg px-3 text-[15px] text-fg placeholder:text-faint transition-[border-color,box-shadow] focus:border-accent focus:outline-none focus:ring-[3px] focus:ring-accent/20';

function FormField({ id, label, required, error, hint, children, className }: { id: string; label: string; required?: boolean; error?: string; hint?: string; children: ReactNode; className?: string }) {
  return (
    <div className={className}>
      <label htmlFor={id} className="mb-1.5 block text-sm font-medium text-fg">
        {label}
        {required ? <span className="ml-0.5 text-accent" aria-hidden>*</span> : <span className="ml-1.5 text-[13px] font-normal text-faint">optional</span>}
      </label>
      {children}
      {error ? (
        <p id={`${id}-error`} className="mt-1.5 text-[13px] text-err" data-testid={`error-${id}`}>
          {error}
        </p>
      ) : hint ? (
        <p className="mt-1.5 text-[13px] text-faint">{hint}</p>
      ) : null}
    </div>
  );
}

type State = { kind: 'idle' } | { kind: 'sending' } | { kind: 'done' } | { kind: 'fallback'; reason: 'unreachable' | 'rate-limited' } | { kind: 'invalid'; message: string };

export default function ContactPage() {
  useDocumentMeta('Request a demo', 'Request a demo of FenestrationOS: elevation CAD, engineering calculation, cutting and nesting, production tracking and purchasing.');
  const loc = useLocation();
  const [f, setF] = useState<LeadForm>(() => ({ ...EMPTY_FORM, interest: interestFromQuery(loc.search) }));
  const [errors, setErrors] = useState<LeadErrors>({});
  const [state, setState] = useState<State>({ kind: 'idle' });
  const openedAt = useRef(Date.now());
  const formRef = useRef<HTMLFormElement>(null);
  const plan = useMemo(() => new URLSearchParams(loc.search).get('plan'), [loc.search]);

  const set = <K extends keyof LeadForm>(k: K, v: LeadForm[K]) => {
    setF((p) => ({ ...p, [k]: v }));
    if (errors[k as keyof LeadErrors]) setErrors((e) => ({ ...e, [k]: undefined }));
  };
  const toggleInterest = (k: (typeof SOLUTION_KEYS)[number]) => set('interest', f.interest.includes(k) ? f.interest.filter((x) => x !== k) : [...f.interest, k]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const errs = validateLead(f);
    setErrors(errs);
    if (Object.keys(errs).length) {
      const first = Object.keys(errs)[0];
      formRef.current?.querySelector<HTMLElement>(`#f-${first}`)?.focus();
      return;
    }
    const elapsed = Date.now() - openedAt.current;
    if (looksAutomated(f, elapsed)) {
      setState({ kind: 'done' }); // never tell a bot it was caught
      return;
    }
    setState({ kind: 'sending' });
    const r = await submitLead(leadPayload(f, elapsed, `${loc.pathname}${loc.search}`));
    if (r.kind === 'ok') setState({ kind: 'done' });
    else if (r.kind === 'invalid') setState({ kind: 'invalid', message: r.message });
    else setState({ kind: 'fallback', reason: r.kind });
  };

  const mailto = buildMailto(f);
  const err = (k: keyof LeadErrors) => ({ 'aria-invalid': errors[k] ? true : undefined, 'aria-describedby': errors[k] ? `f-${k}-error` : undefined });

  return (
    <section className="relative isolate overflow-hidden" aria-labelledby="contact-title">
      <div className="bp-grid pointer-events-none absolute inset-x-0 top-0 -z-10 h-[620px]" aria-hidden />
      <Container className="grid gap-12 py-14 sm:py-20 lg:grid-cols-[1fr_1.25fr] lg:gap-16">
        <div>
          <Eyebrow>Contact</Eyebrow>
          <h1 id="contact-title" className="mt-5 text-balance text-[36px] font-semibold leading-[1.1] tracking-[-0.025em] sm:text-5xl">
            Request a demo
          </h1>
          <p className="mt-5 text-lg leading-[1.6] text-muted">
            Tell us about the systems you design and fabricate. We will show you FenestrationOS working through a project like yours — from elevation to cut list to tracked part.
          </p>
          <h2 className="mt-10 font-mono text-[12px] uppercase tracking-[0.16em] text-faint">What happens next</h2>
          <ol className="mt-4 space-y-4">
            {['We reply by e-mail to understand your workflow and systems.', 'We arrange a walkthrough with the modules you are interested in.', 'If it fits, we discuss catalogue set-up, deployment and pricing.'].map((t, i) => (
              <li key={t} className="flex gap-3.5 text-[15px] leading-[1.55] text-muted">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-sm border border-accent/40 font-mono text-[11px] text-accent">{i + 1}</span>
                {t}
              </li>
            ))}
          </ol>
          <div className="mt-10 rounded-lg border border-line bg-panel p-5">
            <div className="text-sm text-muted">Prefer e-mail?</div>
            <a href={`mailto:${siteConfig.contactEmail}`} className="site-link mt-1 inline-flex items-center gap-2 text-[16px] font-medium text-fg">
              <Mail className="h-4 w-4 text-accent" aria-hidden /> {siteConfig.contactEmail}
            </a>
            {siteConfig.contactPhone && <div className="mt-2 text-[15px] text-muted">{siteConfig.contactPhone}</div>}
            {siteConfig.contactAddress.length > 0 && (
              <address className="mt-2 text-[15px] not-italic leading-[1.55] text-muted">
                {siteConfig.contactAddress.map((l) => (
                  <div key={l}>{l}</div>
                ))}
              </address>
            )}
          </div>
        </div>

        <div className="min-w-0">
          {state.kind === 'done' ? (
            <div className="rounded-xl border border-line bg-panel p-8 sm:p-10" data-testid="contact-success" role="status">
              <CheckCircle2 className="h-10 w-10 text-ok" aria-hidden />
              <h2 className="mt-5 text-2xl font-semibold">Thank you — your request is in.</h2>
              <p className="mt-3 text-[15px] leading-[1.6] text-muted">
                We will reply to <span className="font-medium text-fg">{f.email.trim()}</span>. If anything is urgent, write to{' '}
                <a href={`mailto:${siteConfig.contactEmail}`} className="site-link text-fg">
                  {siteConfig.contactEmail}
                </a>
                .
              </p>
              <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                <Link to="/solutions" className="site-btn site-btn-secondary">
                  Explore the solutions
                </Link>
                <a href="/app" className="site-btn site-btn-secondary">
                  Try the offline demo
                </a>
              </div>
            </div>
          ) : (
            <form ref={formRef} onSubmit={submit} noValidate className="relative rounded-xl border border-line bg-panel p-6 shadow-[0_30px_60px_-40px_rgb(var(--ink)/0.4)] sm:p-8" data-testid="contact-form" aria-describedby="form-required-note">
              {plan && (
                <p className="mb-6 rounded-md border border-accent/30 bg-accent/[0.06] px-3.5 py-2.5 text-sm text-muted">
                  Pricing request for the <span className="font-semibold capitalize text-fg">{plan}</span> plan.
                </p>
              )}
              <div className="grid gap-5 sm:grid-cols-2">
                <FormField id="f-name" label="Name" required error={errors.name}>
                  <input id="f-name" className={clsx(inputCls, 'h-11', errors.name && 'border-err')} autoComplete="name" maxLength={200} value={f.name} onChange={(e) => set('name', e.target.value)} {...err('name')} data-testid="contact-name" />
                </FormField>
                <FormField id="f-company" label="Company" required error={errors.company}>
                  <input id="f-company" className={clsx(inputCls, 'h-11', errors.company && 'border-err')} autoComplete="organization" maxLength={200} value={f.company} onChange={(e) => set('company', e.target.value)} {...err('company')} data-testid="contact-company" />
                </FormField>
                <FormField id="f-email" label="Work e-mail" required error={errors.email}>
                  <input id="f-email" type="email" inputMode="email" className={clsx(inputCls, 'h-11', errors.email && 'border-err')} autoComplete="email" maxLength={254} value={f.email} onChange={(e) => set('email', e.target.value)} {...err('email')} data-testid="contact-email" />
                </FormField>
                <FormField id="f-phone" label="Phone" error={errors.phone}>
                  <input id="f-phone" type="tel" className={clsx(inputCls, 'h-11', errors.phone && 'border-err')} autoComplete="tel" maxLength={50} value={f.phone} onChange={(e) => set('phone', e.target.value)} {...err('phone')} data-testid="contact-phone" />
                </FormField>
                <FormField id="f-country" label="Country" error={errors.country} className="sm:col-span-2">
                  <input id="f-country" className={clsx(inputCls, 'h-11', errors.country && 'border-err')} autoComplete="country-name" maxLength={100} value={f.country} onChange={(e) => set('country', e.target.value)} {...err('country')} data-testid="contact-country" />
                </FormField>
                <fieldset className="sm:col-span-2">
                  <legend className="mb-2 text-sm font-medium text-fg">
                    Interested in <span className="ml-1.5 text-[13px] font-normal text-faint">optional</span>
                  </legend>
                  <div className="flex flex-wrap gap-2">
                    {SOLUTION_KEYS.map((k) => {
                      const on = f.interest.includes(k);
                      return (
                        <label
                          key={k}
                          className={clsx(
                            'flex h-9 cursor-pointer items-center gap-2 rounded-md border px-3 text-sm transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-accent',
                            on ? 'border-accent/60 bg-accent/10 text-fg' : 'border-line-strong text-muted hover:border-faint hover:text-fg',
                          )}
                        >
                          <input type="checkbox" className="sr-only" checked={on} onChange={() => toggleInterest(k)} data-testid={`interest-${k}`} />
                          <span className={clsx('h-3.5 w-3.5 rounded-sm border', on ? 'border-accent bg-accent' : 'border-line-strong')} aria-hidden />
                          {interestLabel(k)}
                        </label>
                      );
                    })}
                  </div>
                </fieldset>
                <FormField id="f-message" label="Your project or question" required error={errors.message} className="sm:col-span-2">
                  <textarea
                    id="f-message"
                    rows={5}
                    maxLength={5000}
                    className={clsx(inputCls, 'resize-y py-2.5 leading-[1.55]', errors.message && 'border-err')}
                    placeholder="Which systems do you fabricate, how many people would use FenestrationOS, what would you like to see?"
                    value={f.message}
                    onChange={(e) => set('message', e.target.value)}
                    {...err('message')}
                    data-testid="contact-message"
                  />
                </FormField>
                {/* honeypot: invisible to people and assistive tech; automated form fillers tend to complete it */}
                <div className="absolute -left-[10000px] top-auto h-px w-px overflow-hidden" aria-hidden="true">
                  <label htmlFor="f-website">Website</label>
                  <input id="f-website" name="website" type="text" tabIndex={-1} autoComplete="off" value={f.website} onChange={(e) => set('website', e.target.value)} data-testid="contact-website" />
                </div>
                <div className="sm:col-span-2">
                  <label className="flex cursor-pointer items-start gap-3 text-sm leading-[1.55] text-muted">
                    <input
                      id="f-consent"
                      type="checkbox"
                      className="mt-0.5 h-[18px] w-[18px] shrink-0 cursor-pointer accent-[rgb(var(--accent))]"
                      checked={f.consent}
                      onChange={(e) => set('consent', e.target.checked)}
                      {...err('consent')}
                      data-testid="contact-consent"
                    />
                    <span>
                      I agree that {siteConfig.companyName} may store these details and contact me about this request. See the{' '}
                      <Link to="/privacy" className="site-link text-fg">
                        privacy policy
                      </Link>
                      .
                    </span>
                  </label>
                  {errors.consent && (
                    <p id="f-consent-error" className="mt-1.5 text-[13px] text-err" data-testid="error-f-consent">
                      {errors.consent}
                    </p>
                  )}
                </div>
              </div>

              {state.kind === 'fallback' && (
                <div className="mt-6 rounded-lg border border-warn/40 bg-warn/[0.07] p-4" role="alert" data-testid="contact-fallback">
                  <div className="flex items-start gap-3">
                    <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-warn" aria-hidden />
                    <div className="min-w-0 text-sm leading-[1.55] text-muted">
                      <div className="font-semibold text-fg">{state.reason === 'rate-limited' ? 'Too many requests from this network.' : 'We could not send your request right now.'}</div>
                      Please e-mail us at{' '}
                      <a href={mailto} className="site-link break-all font-medium text-fg" data-testid="contact-mailto">
                        {siteConfig.contactEmail}
                      </a>{' '}
                      — your details are already filled in.
                      <div className="mt-3">
                        <a href={mailto} className="site-btn site-btn-sm site-btn-secondary">
                          <Mail className="h-4 w-4" aria-hidden /> Open e-mail with my details
                        </a>
                      </div>
                    </div>
                  </div>
                </div>
              )}
              {state.kind === 'invalid' && (
                <p className="mt-6 rounded-md border border-err/40 bg-err/[0.06] px-3.5 py-2.5 text-sm text-err" role="alert" data-testid="contact-invalid">
                  {state.message}
                </p>
              )}

              <div className="mt-7 flex flex-col-reverse gap-4 sm:flex-row sm:items-center sm:justify-between">
                <p id="form-required-note" className="text-[13px] text-faint">
                  <span className="text-accent">*</span> required
                </p>
                <button type="submit" className="site-btn site-btn-primary sm:min-w-[200px]" disabled={state.kind === 'sending'} data-testid="contact-submit">
                  {state.kind === 'sending' ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
                  {state.kind === 'sending' ? 'Sending…' : 'Send request'}
                  {state.kind !== 'sending' && <ArrowRight className="h-4 w-4" aria-hidden />}
                </button>
              </div>
            </form>
          )}
        </div>
      </Container>
    </section>
  );
}
