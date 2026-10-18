import { ArrowRight, Check } from 'lucide-react';
import { Link } from 'react-router-dom';
import { FEATURES, SHOTS, SOLUTIONS, WORKFLOW } from '../content';
import { useDocumentMeta } from '../useDocumentMeta';
import { BrowserFrame, Container, CtaBand, Eyebrow, IconTile, PhoneFrame, Reveal, SectionHeading, SOLUTION_ICONS, StatusNote, TextLink } from '../ui';

export default function HomePage() {
  useDocumentMeta(
    null,
    'FenestrationOS connects curtain-wall elevation design, engineering calculation, cutting and nesting optimisation, QR production tracking and purchasing in one system.',
  );
  return (
    <>
      <Hero />
      <Workflow />
      <Solutions />
      <Showcase />
      <Features />
      <Integrity />
      <CtaBand />
    </>
  );
}

function Hero() {
  return (
    <section className="relative isolate overflow-hidden" aria-labelledby="hero-title" data-testid="home-hero">
      <div className="bp-grid pointer-events-none absolute inset-x-0 top-0 -z-10 h-[820px]" aria-hidden />
      <div className="pointer-events-none absolute left-1/2 top-[420px] -z-10 h-[520px] w-[1100px] -translate-x-1/2 rounded-full bg-accent/[0.08] blur-3xl" aria-hidden />
      <Container className="pb-16 pt-14 sm:pb-24 sm:pt-20 lg:pt-24">
        <div className="mx-auto max-w-[880px] text-center">
          <Eyebrow className="justify-center !text-[11px] !tracking-[0.1em] sm:!text-[12px] sm:!tracking-[0.16em]">Fenestration CAD · Engineering · Manufacturing</Eyebrow>
          <h1 id="hero-title" className="mt-6 text-balance text-[38px] font-semibold leading-[1.08] tracking-[-0.025em] text-fg sm:text-5xl lg:text-6xl">
            From elevation drawing to dispatched part, in one system.
          </h1>
          <p className="mx-auto mt-6 max-w-[680px] text-pretty text-lg leading-[1.6] text-muted sm:text-[19px]">
            FenestrationOS connects curtain-wall design, engineering calculation, cutting optimisation, production tracking and purchasing — so every number on the shop floor traces back to the drawing it came from.
          </p>
          <div className="mt-9 flex flex-col justify-center gap-3 sm:flex-row">
            <Link to="/contact" className="site-btn site-btn-primary" data-testid="hero-demo">
              Request a demo <ArrowRight className="h-4 w-4" aria-hidden />
            </Link>
            <Link to="/solutions" className="site-btn site-btn-secondary">
              Explore the solutions
            </Link>
          </div>
          <p className="mt-5 text-sm text-faint">
            Or{' '}
            <a href="/app" className="site-link text-muted">
              open the app in offline demo mode
            </a>{' '}
            — no account needed.
          </p>
        </div>
        <Reveal className="mx-auto mt-14 max-w-[1100px] sm:mt-20">
          <BrowserFrame shot={SHOTS.editor} fig="01" eager />
        </Reveal>
      </Container>
    </section>
  );
}

function Workflow() {
  return (
    <section className="border-y border-line bg-panel" aria-labelledby="workflow-title">
      <Container className="py-16 sm:py-24">
        <SectionHeading
          n="01"
          eyebrow="One workflow"
          id="workflow-title"
          title="Six steps, one set of data."
          intro="Each step works from the output of the one before it. Nothing is re-typed between engineering, the shop floor and purchasing."
        />
        <ol className="relative mt-12 grid grid-cols-2 gap-x-6 gap-y-10 sm:grid-cols-3 lg:grid-cols-6 lg:gap-x-4">
          <span className="absolute left-0 right-[calc((100%-5rem)/6)] top-[19px] hidden h-px bg-line-strong lg:block" aria-hidden />
          {WORKFLOW.map((s, i) => (
            <Reveal as="li" key={s.n} delay={i * 60} className="relative">
              <div className="flex items-center gap-3">
                <span className="relative z-[1] flex h-10 w-10 items-center justify-center rounded-md border border-accent/40 bg-panel font-mono text-[13px] font-medium text-accent">{s.n}</span>
                {i < WORKFLOW.length - 1 && <span className="h-px flex-1 bg-line-strong lg:hidden" aria-hidden />}
              </div>
              <h3 className="mt-4 text-[17px] font-semibold text-fg">{s.title}</h3>
              <p className="mt-1.5 text-sm leading-[1.55] text-muted">{s.text}</p>
            </Reveal>
          ))}
        </ol>
      </Container>
    </section>
  );
}

function Solutions() {
  return (
    <section aria-labelledby="solutions-title">
      <Container className="py-16 sm:py-24">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <SectionHeading n="02" eyebrow="Solutions" id="solutions-title" title="Four modules that fit together." intro="Start with design and calculation, add optimisation, production and purchasing as your team is ready." />
          <TextLink to="/solutions" className="shrink-0">
            How they connect
          </TextLink>
        </div>
        <ul className="mt-12 grid gap-5 md:grid-cols-2">
          {SOLUTIONS.map((s, i) => {
            const I = SOLUTION_ICONS[s.key];
            return (
              <Reveal as="li" key={s.key} delay={(i % 2) * 80}>
                <Link
                  to={`/solutions/${s.key}`}
                  className="group relative flex h-full flex-col rounded-lg border border-line bg-panel p-6 transition-[border-color,box-shadow,transform] duration-200 hover:-translate-y-0.5 hover:border-accent/40 hover:shadow-[0_20px_40px_-24px_rgb(var(--ink)/0.35)] sm:p-8"
                  data-testid={`card-${s.key}`}
                >
                  <div className="flex items-start justify-between gap-4">
                    <IconTile Icon={I} />
                    <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-faint">0{i + 1}</span>
                  </div>
                  <h3 className="mt-6 text-xl font-semibold text-fg">{s.title}</h3>
                  <p className="mt-2 text-[15px] leading-[1.6] text-muted">{s.summary}</p>
                  <ul className="mt-5 space-y-2">
                    {s.bullets.slice(0, 3).map((b) => (
                      <li key={b} className="flex gap-2.5 text-sm leading-[1.5] text-muted">
                        <Check className="mt-0.5 h-4 w-4 shrink-0 text-accent" aria-hidden />
                        <span>{b}</span>
                      </li>
                    ))}
                  </ul>
                  <span className="mt-auto inline-flex items-center gap-1.5 pt-6 text-[15px] font-medium text-accent">
                    Explore {s.short} <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" aria-hidden />
                  </span>
                </Link>
              </Reveal>
            );
          })}
        </ul>
      </Container>
    </section>
  );
}

function Showcase() {
  return (
    <section className="relative overflow-hidden border-y border-line bg-panel" aria-labelledby="showcase-title">
      <Container className="grid items-center gap-12 py-16 sm:py-24 lg:grid-cols-[1fr_1.35fr] lg:gap-16">
        <div>
          <SectionHeading
            n="03"
            eyebrow="Office to shop floor"
            id="showcase-title"
            title="The cut list and the saw read the same data."
            intro="Optimised bar plans go to the saw; every piece gets a QR label; operators scan it at each station from a phone. Engineering sees progress part by part."
          />
          <div className="mt-8 flex flex-wrap gap-x-8 gap-y-3">
            <TextLink to="/solutions/cutting-nesting">Cutting &amp; nesting</TextLink>
            <TextLink to="/solutions/production-tracking">Production tracking</TextLink>
          </div>
        </div>
        <Reveal className="relative pb-10 sm:pb-0 sm:pr-20 lg:pr-24">
          <BrowserFrame shot={SHOTS.cutting} fig="02" />
          <div className="absolute right-0 top-10 hidden w-[140px] drop-shadow-[0_24px_30px_rgb(var(--ink)/0.25)] sm:block lg:w-[150px]">
            <PhoneFrame shot={SHOTS.station} marks={false} />
          </div>
        </Reveal>
      </Container>
    </section>
  );
}

function Features() {
  return (
    <section aria-labelledby="features-title">
      <Container className="py-16 sm:py-24">
        <SectionHeading n="04" eyebrow="Capabilities" id="features-title" title="Everything the workflow needs, nothing bolted on." />
        <ul className="mt-12 grid overflow-hidden rounded-lg border border-line bg-line sm:grid-cols-2 lg:grid-cols-5" style={{ gap: '1px' }}>
          {FEATURES.map((f, i) => (
            <Reveal as="li" key={f.title} delay={(i % 5) * 50} className="bg-panel p-6">
              <IconTile icon={f.icon} />
              <h3 className="mt-5 text-[16px] font-semibold leading-snug text-fg">{f.title}</h3>
              <p className="mt-2 text-sm leading-[1.55] text-muted">{f.text}</p>
            </Reveal>
          ))}
        </ul>
      </Container>
    </section>
  );
}

function StatusRow({ chip, tone, title, text, step }: { chip: string; tone: 'prov' | 'ok' | 'accent'; title: string; text: string; step: string }) {
  const toneCls = { prov: 'border-prov/45 bg-prov/10 text-prov', ok: 'border-ok/45 bg-ok/10 text-ok', accent: 'border-accent/45 bg-accent/10 text-accent' }[tone];
  return (
    <li className="relative flex gap-4 pb-7 last:pb-0">
      <div className="flex flex-col items-center">
        <span className="flex h-7 w-7 items-center justify-center rounded-full border border-line-strong bg-panel font-mono text-[11px] text-muted">{step}</span>
        <span className="mt-1 w-px flex-1 bg-line-strong" aria-hidden />
      </div>
      <div className="min-w-0 pt-0.5">
        <span className={`inline-flex h-6 items-center rounded-sm border px-2 font-mono text-[11px] font-semibold uppercase tracking-wider ${toneCls}`}>{chip}</span>
        <div className="mt-2 text-[15px] font-semibold text-fg">{title}</div>
        <p className="mt-1 text-sm leading-[1.55] text-muted">{text}</p>
      </div>
    </li>
  );
}

function Integrity() {
  return (
    <section className="border-t border-line" aria-labelledby="integrity-title">
      <Container className="grid gap-12 py-16 sm:py-24 lg:grid-cols-2 lg:gap-20">
        <div>
          <SectionHeading
            n="05"
            eyebrow="Engineering integrity"
            id="integrity-title"
            title="Built so you can trust — and check — every result."
            intro="Software should make engineering judgement easier to apply, not hide it. FenestrationOS is explicit about where each number came from and how far it can be relied on."
          />
          <ul className="mt-8 space-y-4">
            {[
              ['Provisional until approved.', 'Results computed with a rule set that has not been approved by your engineer are labelled provisional — on screen, in reports and on labels.'],
              ['Independent checker.', 'Cutting and nesting plans are re-verified by a separately written validator before they are shown. A failed check is never presented as a result.'],
              ['Reproducible.', 'Engine and catalogue versions are stored with every calculation run, and every change is written to the audit trail.'],
            ].map(([t, d]) => (
              <li key={t} className="flex gap-3 text-[15px] leading-[1.6] text-muted">
                <Check className="mt-1 h-4 w-4 shrink-0 text-accent" aria-hidden />
                <span>
                  <strong className="font-semibold text-fg">{t}</strong> {d}
                </span>
              </li>
            ))}
          </ul>
        </div>
        <Reveal>
          <div className="reg-marks">
            <div className="rounded-lg border border-line-strong bg-panel p-6 shadow-[0_30px_60px_-36px_rgb(var(--ink)/0.4)] sm:p-8">
              <div className="flex items-center justify-between gap-3 border-b border-line pb-4">
                <div className="font-mono text-[12px] uppercase tracking-[0.14em] text-faint">Result status</div>
                <div className="truncate font-mono text-[11px] text-faint">engine · catalogue · rule set</div>
              </div>
              <ol className="mt-6">
                <StatusRow step="1" chip="Provisional · demo rules" tone="prov" title="Calculated" text="The rule set is not yet approved. The result is usable for estimating and review, clearly marked." />
                <StatusRow step="2" chip="Validator passed" tone="accent" title="Independently checked" text="Every bar, cut, pane and remnant re-checked against the input by a separate validator." />
                <StatusRow step="3" chip="Validated" tone="ok" title="Approved rules" text="Shown only when the rule set is approved and has passed its reference test cases." />
              </ol>
            </div>
          </div>
          <StatusNote className="mt-6">The public demo runs with illustrative catalogue data and provisional rules; its results always carry the provisional label.</StatusNote>
        </Reveal>
      </Container>
    </section>
  );
}
