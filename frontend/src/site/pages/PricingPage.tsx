import clsx from 'clsx';
import { ArrowRight, Check, Minus, Plus } from 'lucide-react';
import { Link } from 'react-router-dom';
import { priceLabel, siteConfig, type Cell } from '../siteConfig';
import { useDocumentMeta } from '../useDocumentMeta';
import { Container, CtaBand, Eyebrow, SectionHeading } from '../ui';

function CellView({ v }: { v: Cell }) {
  if (v === true)
    return (
      <span className="inline-flex items-center justify-center text-accent">
        <Check className="h-[18px] w-[18px]" aria-hidden />
        <span className="sr-only">Included</span>
      </span>
    );
  if (v === false)
    return (
      <span className="inline-flex items-center justify-center text-faint">
        <Minus className="h-4 w-4" aria-hidden />
        <span className="sr-only">Not included</span>
      </span>
    );
  return <span className="text-sm text-muted">{v}</span>;
}

export default function PricingPage() {
  useDocumentMeta('Pricing', 'FenestrationOS plans — Starter, Professional and Enterprise — with a feature comparison and answers to common questions.');
  const { plans, comparison, faq, pricingNote } = siteConfig;
  return (
    <div data-testid="pricing-page">
      <section className="relative isolate overflow-hidden" aria-labelledby="pricing-title">
        <div className="bp-grid pointer-events-none absolute inset-x-0 top-0 -z-10 h-[560px]" aria-hidden />
        <Container className="pb-10 pt-14 text-center sm:pt-20">
          <Eyebrow className="justify-center">Pricing</Eyebrow>
          <h1 id="pricing-title" className="mx-auto mt-5 max-w-[760px] text-balance text-[36px] font-semibold leading-[1.1] tracking-[-0.025em] sm:text-5xl">
            Plans that grow with your workflow.
          </h1>
          <p className="mx-auto mt-5 max-w-[620px] text-lg leading-[1.6] text-muted">{pricingNote}</p>
        </Container>
      </section>

      <Container>
        <ul className="grid gap-5 lg:grid-cols-3" data-testid="plans">
          {plans.map((p) => {
            const price = priceLabel(p);
            return (
              <li
                key={p.id}
                data-testid={`plan-${p.id}`}
                className={clsx(
                  'relative flex flex-col rounded-xl border bg-panel p-7 sm:p-8',
                  p.featured ? 'border-accent/60 shadow-[0_30px_60px_-34px_rgb(var(--accent)/0.55)]' : 'border-line',
                )}
              >
                {p.featured && <span className="absolute -top-3 left-7 rounded-sm bg-accent px-2 py-0.5 font-mono text-[11px] font-medium uppercase tracking-[0.12em] text-[rgb(var(--on-accent))]">Full workflow</span>}
                <h2 className="text-xl font-semibold">{p.name}</h2>
                <p className="mt-2 min-h-[48px] text-[15px] leading-[1.55] text-muted">{p.tagline}</p>
                <div className="mt-6 border-y border-line py-5">
                  <div className="text-3xl font-semibold tracking-tight" data-testid={`price-${p.id}`}>
                    {price.amount}
                  </div>
                  <div className="mt-1 h-5 text-sm text-faint">{price.period}</div>
                </div>
                <ul className="mt-6 flex-1 space-y-3">
                  {p.highlights.map((h) => (
                    <li key={h} className="flex gap-2.5 text-[15px] leading-[1.5] text-muted">
                      <Check className="mt-0.5 h-4 w-4 shrink-0 text-accent" aria-hidden />
                      {h}
                    </li>
                  ))}
                </ul>
                <Link to={`/contact?plan=${p.id}`} className={clsx('site-btn mt-8 w-full', p.featured ? 'site-btn-primary' : 'site-btn-secondary')}>
                  {p.cta} <ArrowRight className="h-4 w-4" aria-hidden />
                </Link>
              </li>
            );
          })}
        </ul>
      </Container>

      <section aria-labelledby="compare-title">
        <Container className="py-16 sm:py-24">
          <SectionHeading n="01" eyebrow="Compare" id="compare-title" title="What each plan includes." />
          <div className="relative mt-10 overflow-x-auto rounded-lg border border-line bg-panel" data-testid="compare-scroll">
            <table className="w-full min-w-[640px] border-collapse text-left" data-testid="compare-table">
              <caption className="sr-only">Feature comparison by plan</caption>
              <thead>
                <tr className="border-b border-line bg-raised/50">
                  <th scope="col" className="px-5 py-4 font-mono text-[11px] font-medium uppercase tracking-[0.14em] text-faint">
                    Feature
                  </th>
                  {plans.map((p) => (
                    <th key={p.id} scope="col" className={clsx('w-[18%] px-4 py-4 text-center text-sm font-semibold', p.featured && 'text-accent')}>
                      {p.name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {comparison.map((r) => (
                  <tr key={r.feature} className="border-b border-line last:border-b-0">
                    <th scope="row" className="px-5 py-3.5 text-[15px] font-normal text-fg">
                      {r.feature}
                    </th>
                    {plans.map((p) => (
                      <td key={p.id} className={clsx('px-4 py-3.5 text-center', p.featured && 'bg-accent/[0.03]')}>
                        <CellView v={r.values[p.id]} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Container>
      </section>

      <section className="border-t border-line bg-panel" aria-labelledby="faq-title">
        <Container className="grid gap-10 py-16 sm:py-24 lg:grid-cols-[1fr_1.6fr] lg:gap-16">
          <SectionHeading n="02" eyebrow="FAQ" id="faq-title" title="Common questions." intro={<>Something else? <Link to="/contact" className="site-link text-fg">Ask us directly</Link>.</>} />
          <div className="divide-y divide-line border-y border-line">
            {faq.map((f) => (
              <details key={f.q} className="group py-1">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 py-4 text-[16px] font-medium text-fg [&::-webkit-details-marker]:hidden">
                  {f.q}
                  <Plus className="h-4 w-4 shrink-0 text-faint transition-transform group-open:rotate-45" aria-hidden />
                </summary>
                <p className="pb-5 pr-8 text-[15px] leading-[1.65] text-muted">{f.a}</p>
              </details>
            ))}
          </div>
        </Container>
      </section>
      <div className="pt-16 sm:pt-20">
        <CtaBand title="Get a quotation for your team." text="Tell us which modules you need, how many people will use them and whether you prefer cloud or on-premise." />
      </div>
    </div>
  );
}
