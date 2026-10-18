import { Link } from 'react-router-dom';
import { SOLUTIONS } from '../content';
import { useDocumentMeta } from '../useDocumentMeta';
import { Container } from '../ui';

export default function NotFoundPage() {
  useDocumentMeta('Page not found', 'The page you were looking for does not exist.');
  return (
    <section className="relative isolate overflow-hidden" data-testid="not-found">
      <div className="bp-grid pointer-events-none absolute inset-0 -z-10" aria-hidden />
      <Container className="py-24 sm:py-32">
        <div className="font-mono text-[13px] uppercase tracking-[0.16em] text-accent">Error 404</div>
        <h1 className="mt-4 text-4xl font-semibold sm:text-5xl">This page is not on the drawing.</h1>
        <p className="mt-5 max-w-[560px] text-lg leading-[1.6] text-muted">The address may be mistyped, or the page has moved. Here are some places to continue:</p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Link to="/" className="site-btn site-btn-primary">
            Home
          </Link>
          <Link to="/solutions" className="site-btn site-btn-secondary">
            Solutions
          </Link>
          <a href="/app" className="site-btn site-btn-secondary">
            Open the app
          </a>
        </div>
        <ul className="mt-10 space-y-2 text-[15px]">
          {SOLUTIONS.map((s) => (
            <li key={s.key}>
              <Link to={`/solutions/${s.key}`} className="site-link text-muted">
                {s.title}
              </Link>
            </li>
          ))}
        </ul>
      </Container>
    </section>
  );
}
