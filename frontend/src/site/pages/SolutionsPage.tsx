import { ArrowRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import { SOLUTIONS, WORKFLOW } from '../content';
import { useDocumentMeta } from '../useDocumentMeta';
import { BrowserFrame, Container, CtaBand, Eyebrow, IconTile, Reveal, SOLUTION_ICONS } from '../ui';

export default function SolutionsPage() {
  useDocumentMeta('Solutions', 'Design & calculation, cutting & nesting, production tracking and purchasing & quotes — four FenestrationOS modules working from one set of data.');
  return (
    <>
      <section className="relative isolate overflow-hidden border-b border-line" aria-labelledby="sol-title">
        <div className="bp-grid pointer-events-none absolute inset-0 -z-10" aria-hidden />
        <Container className="py-16 sm:py-24">
          <Eyebrow>Solutions</Eyebrow>
          <h1 id="sol-title" className="mt-5 max-w-[820px] text-balance text-[36px] font-semibold leading-[1.1] tracking-[-0.025em] sm:text-5xl">
            One connected system for façade engineering and fabrication.
          </h1>
          <p className="mt-6 max-w-[680px] text-lg leading-[1.6] text-muted">
            Four modules share projects, the catalogue and every calculation run. Use them together for the full workflow, or start with the part that hurts most today.
          </p>
          <ol className="mt-10 flex flex-wrap items-center gap-x-2 gap-y-3 font-mono text-[12px] uppercase tracking-[0.12em] text-muted" aria-label="Workflow">
            {WORKFLOW.map((w, i) => (
              <li key={w.n} className="flex items-center gap-2">
                <span className="rounded-sm border border-line-strong bg-panel px-2 py-1">
                  <span className="text-accent">{w.n}</span> {w.title}
                </span>
                {i < WORKFLOW.length - 1 && <ArrowRight className="h-3.5 w-3.5 text-faint" aria-hidden />}
              </li>
            ))}
          </ol>
        </Container>
      </section>
      <Container className="py-8 sm:py-12">
        {SOLUTIONS.map((s, i) => {
          const I = SOLUTION_ICONS[s.key];
          return (
            <section key={s.key} className="grid items-center gap-10 border-b border-line py-12 last:border-b-0 sm:py-16 lg:grid-cols-2 lg:gap-16" aria-labelledby={`h-${s.key}`}>
              <div className={i % 2 ? 'lg:order-2' : ''}>
                <div className="flex items-center gap-3">
                  <IconTile Icon={I} />
                  <span className="font-mono text-[12px] uppercase tracking-[0.16em] text-faint">Module 0{i + 1}</span>
                </div>
                <h2 id={`h-${s.key}`} className="mt-5 text-3xl font-semibold">
                  {s.title}
                </h2>
                <p className="mt-3 text-lg leading-[1.6] text-muted">{s.heroText}</p>
                <Link to={`/solutions/${s.key}`} className="site-btn site-btn-secondary mt-7" data-testid={`overview-${s.key}`}>
                  {s.title} in detail <ArrowRight className="h-4 w-4" aria-hidden />
                </Link>
              </div>
              <Reveal className={i % 2 ? 'lg:order-1' : ''}>
                <BrowserFrame shot={s.shots[0]} fig={`0${i + 1}`} />
              </Reveal>
            </section>
          );
        })}
      </Container>
      <CtaBand />
    </>
  );
}
