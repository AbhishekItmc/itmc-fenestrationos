import { ArrowRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import { SOLUTIONS } from '../content';
import { filledFacts, siteConfig } from '../siteConfig';
import { useDocumentMeta } from '../useDocumentMeta';
import { Container, CtaBand, Eyebrow, IconTile, SectionHeading, SOLUTION_ICONS } from '../ui';

const PRINCIPLES = [
  { t: 'Engineering first', d: 'Calculations show their formulas and inputs. Results that rely on unapproved rules say so, everywhere they appear.' },
  { t: 'One source of data', d: 'Drawings, bills of materials, cut lists, parts and purchase orders are linked, so a change in one place is not lost in another.' },
  { t: 'Honest status', d: 'Demo data is labelled as demo data. Optimised plans are checked by an independent validator before they are shown.' },
  { t: 'Your deployment', d: 'Run it as a hosted service or on your own infrastructure, with role-based access and a complete audit trail.' },
];

export default function AboutPage() {
  useDocumentMeta('About', `${siteConfig.companyName} builds FenestrationOS — software for designing, engineering and manufacturing façades and fenestration systems.`);
  const facts = filledFacts(siteConfig.about.facts);
  return (
    <>
      <section className="relative isolate overflow-hidden border-b border-line" aria-labelledby="about-title">
        <div className="bp-grid pointer-events-none absolute inset-0 -z-10" aria-hidden />
        <Container className="py-16 sm:py-24">
          <Eyebrow>About {siteConfig.companyName}</Eyebrow>
          <h1 id="about-title" className="mt-5 max-w-[860px] text-balance text-[36px] font-semibold leading-[1.1] tracking-[-0.025em] sm:text-5xl">
            Software for the people who engineer and build façades.
          </h1>
          <p className="mt-6 max-w-[720px] text-lg leading-[1.65] text-muted" data-testid="about-mission">
            {siteConfig.about.mission}
          </p>
          {facts.length > 0 && (
            <dl className="mt-10 grid max-w-[720px] grid-cols-1 gap-px overflow-hidden rounded-lg border border-line bg-line sm:grid-cols-3" data-testid="about-facts">
              {facts.map((f) => (
                <div key={f.label} className="bg-panel p-5">
                  <dt className="font-mono text-[11px] uppercase tracking-[0.14em] text-faint">{f.label}</dt>
                  <dd className="mt-1.5 text-lg font-semibold">{f.value}</dd>
                </div>
              ))}
            </dl>
          )}
        </Container>
      </section>
      {siteConfig.about.story.length > 0 && (
        <section aria-labelledby="story-title">
          <Container className="py-16 sm:py-20">
            <SectionHeading eyebrow="Our story" id="story-title" title="How we got here." />
            <div className="mt-8 max-w-[720px] space-y-5 text-[17px] leading-[1.7] text-muted">
              {siteConfig.about.story.map((p) => (
                <p key={p}>{p}</p>
              ))}
            </div>
          </Container>
        </section>
      )}
      <section aria-labelledby="build-title">
        <Container className="py-16 sm:py-24">
          <SectionHeading n="01" eyebrow="What we build" id="build-title" title="FenestrationOS, one module at a time." intro="Four modules that share one data model, from the first elevation sketch to the last dispatched part." />
          <ul className="mt-10 grid gap-5 sm:grid-cols-2">
            {SOLUTIONS.map((s) => (
              <li key={s.key}>
                <Link to={`/solutions/${s.key}`} className="group flex h-full gap-4 rounded-lg border border-line bg-panel p-6 transition-colors hover:border-accent/40">
                  <IconTile Icon={SOLUTION_ICONS[s.key]} />
                  <span>
                    <span className="flex items-center gap-1.5 text-[17px] font-semibold">
                      {s.title} <ArrowRight className="h-4 w-4 text-accent transition-transform group-hover:translate-x-0.5" aria-hidden />
                    </span>
                    <span className="mt-1 block text-sm leading-[1.55] text-muted">{s.summary}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </Container>
      </section>
      <section className="border-y border-line bg-panel" aria-labelledby="principles-title">
        <Container className="py-16 sm:py-24">
          <SectionHeading n="02" eyebrow="How we work" id="principles-title" title="Principles we build by." />
          <ol className="mt-10 grid gap-x-10 gap-y-8 sm:grid-cols-2">
            {PRINCIPLES.map((p, i) => (
              <li key={p.t} className="border-t border-line-strong pt-5">
                <div className="font-mono text-[12px] text-accent">{String(i + 1).padStart(2, '0')}</div>
                <h3 className="mt-2 text-lg font-semibold">{p.t}</h3>
                <p className="mt-2 text-[15px] leading-[1.6] text-muted">{p.d}</p>
              </li>
            ))}
          </ol>
        </Container>
      </section>
      <div className="pt-16 sm:pt-20">
        <CtaBand title="Let’s talk about your workflow." />
      </div>
    </>
  );
}
