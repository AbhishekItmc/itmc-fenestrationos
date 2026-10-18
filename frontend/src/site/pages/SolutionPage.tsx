import { ArrowRight, Check } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import { solutionByKey } from '../content';
import { useDocumentMeta } from '../useDocumentMeta';
import { BrowserFrame, Container, CtaBand, Eyebrow, IconTile, PhoneFrame, Reveal, SectionHeading, SOLUTION_ICONS, StatusNote } from '../ui';
import NotFoundPage from './NotFoundPage';

export default function SolutionPage() {
  const { key = '' } = useParams();
  const s = solutionByKey(key);
  if (!s) return <NotFoundPage />;
  return <Solution key={s.key} k={s.key} />;
}

function Solution({ k }: { k: string }) {
  const s = solutionByKey(k)!;
  useDocumentMeta(s.title, s.metaDescription);
  const I = SOLUTION_ICONS[s.key];
  const [main, second] = s.shots;
  return (
    <article data-testid={`solution-${s.key}`}>
      <section className="relative isolate overflow-hidden" aria-labelledby="solution-title">
        <div className="bp-grid pointer-events-none absolute inset-x-0 top-0 -z-10 h-[640px]" aria-hidden />
        <Container className="pb-12 pt-12 sm:pb-16 sm:pt-20">
          <nav aria-label="Breadcrumb" className="font-mono text-[12px] uppercase tracking-[0.14em] text-faint">
            <Link to="/solutions" className="hover:text-fg">
              Solutions
            </Link>
            <span className="mx-2">/</span>
            <span className="text-accent">{s.title}</span>
          </nav>
          <div className="mt-8 grid gap-8 lg:grid-cols-[1.2fr_1fr] lg:items-end lg:gap-16">
            <div>
              <IconTile Icon={I} className="h-12 w-12" />
              <h1 id="solution-title" className="mt-6 text-balance text-[34px] font-semibold leading-[1.1] tracking-[-0.025em] sm:text-5xl">
                {s.heroTitle}
              </h1>
            </div>
            <div>
              <p className="text-lg leading-[1.6] text-muted">{s.heroText}</p>
              <div className="mt-7 flex flex-col gap-3 sm:flex-row">
                <Link to={`/contact?interest=${s.key}`} className="site-btn site-btn-primary">
                  Request a demo <ArrowRight className="h-4 w-4" aria-hidden />
                </Link>
                <a href="/app" className="site-btn site-btn-secondary">
                  Try it in the app
                </a>
              </div>
            </div>
          </div>
          <Reveal className="mx-auto mt-14 max-w-[1100px]">
            <BrowserFrame shot={main} fig="01" eager />
          </Reveal>
        </Container>
      </section>

      <section className="border-y border-line bg-panel" aria-labelledby="what-title">
        <Container className="grid gap-12 py-16 sm:py-24 lg:grid-cols-[1fr_1.3fr] lg:gap-20">
          <div>
            <SectionHeading n="01" eyebrow="What it does" id="what-title" title={s.summary} />
            {s.note && <StatusNote className="mt-8">{s.note}</StatusNote>}
          </div>
          <ul className="divide-y divide-line border-y border-line">
            {s.bullets.map((b) => (
              <li key={b} className="flex gap-4 py-4 text-[15px] leading-[1.6] text-muted">
                <span className="mt-1 flex h-5 w-5 shrink-0 items-center justify-center rounded-sm bg-accent/10 text-accent">
                  <Check className="h-3.5 w-3.5" aria-hidden />
                </span>
                <span>{b}</span>
              </li>
            ))}
          </ul>
        </Container>
      </section>

      <section aria-labelledby="how-title">
        <Container className="py-16 sm:py-24">
          <SectionHeading n="02" eyebrow="How it works" id="how-title" title="From input to result in four steps." />
          <ol className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {s.steps.map((st, i) => (
              <Reveal as="li" key={st.title} delay={i * 70} className="relative rounded-lg border border-line bg-panel p-6">
                <div className="font-mono text-[12px] uppercase tracking-[0.16em] text-accent">Step {String(i + 1).padStart(2, '0')}</div>
                <h3 className="mt-4 text-[17px] font-semibold">{st.title}</h3>
                <p className="mt-2 text-sm leading-[1.6] text-muted">{st.text}</p>
              </Reveal>
            ))}
          </ol>
          {second && (
            <Reveal className={second.phone ? 'mt-16 flex justify-center' : 'mx-auto mt-16 max-w-[1100px]'}>
              {second.phone ? <PhoneFrame shot={second} fig="02" className="max-w-[300px]" /> : <BrowserFrame shot={second} fig="02" />}
            </Reveal>
          )}
        </Container>
      </section>

      <section className="border-t border-line bg-panel" aria-labelledby="related-title">
        <Container className="py-16 sm:py-20">
          <Eyebrow n="03">Related</Eyebrow>
          <h2 id="related-title" className="mt-4 text-2xl font-semibold sm:text-3xl">
            Works with
          </h2>
          <ul className="mt-8 grid gap-5 md:grid-cols-2">
            {s.related.map((rk) => {
              const r = solutionByKey(rk)!;
              const RI = SOLUTION_ICONS[r.key];
              return (
                <li key={rk}>
                  <Link to={`/solutions/${r.key}`} className="group flex h-full items-start gap-4 rounded-lg border border-line bg-bg p-6 transition-colors hover:border-accent/40">
                    <IconTile Icon={RI} />
                    <span className="min-w-0">
                      <span className="flex items-center gap-1.5 text-[17px] font-semibold text-fg">
                        {r.title} <ArrowRight className="h-4 w-4 text-accent transition-transform group-hover:translate-x-0.5" aria-hidden />
                      </span>
                      <span className="mt-1 block text-sm leading-[1.55] text-muted">{r.summary}</span>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </Container>
      </section>
      <div className="pt-16 sm:pt-20">
        <CtaBand title={`See ${s.title.toLowerCase()} with your own projects.`} />
      </div>
    </article>
  );
}
