import clsx from 'clsx';
import {
  ArrowRight,
  Calculator,
  CloudOff,
  FileText,
  LayoutGrid,
  PenTool,
  QrCode,
  Ruler,
  Server,
  ShieldCheck,
  ShoppingCart,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { FeatureIcon, Shot } from './content';
import { siteConfig, type SolutionKey } from './siteConfig';

export function Container({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={clsx('mx-auto w-full max-w-[1200px] px-4 sm:px-8', className)}>{children}</div>;
}

/** Small engineering-style section label: "01 — WORKFLOW". */
export function Eyebrow({ n, children, className }: { n?: string; children: ReactNode; className?: string }) {
  return (
    <div className={clsx('flex items-center gap-2.5 font-mono text-[12px] font-medium uppercase tracking-[0.16em] text-accent', className)}>
      {n && <span className="text-faint">{n}</span>}
      {n && <span className="h-px w-6 bg-accent/60" aria-hidden />}
      <span>{children}</span>
    </div>
  );
}

export function SectionHeading({ n, eyebrow, title, intro, center, id }: { n?: string; eyebrow: string; title: ReactNode; intro?: ReactNode; center?: boolean; id?: string }) {
  return (
    <div className={clsx('max-w-[720px]', center && 'mx-auto text-center')}>
      <Eyebrow n={n} className={clsx(center && 'justify-center')}>
        {eyebrow}
      </Eyebrow>
      <h2 id={id} className="mt-4 text-balance text-3xl font-semibold text-fg sm:text-4xl">
        {title}
      </h2>
      {intro && <p className="mt-4 text-pretty text-lg leading-[1.6] text-muted">{intro}</p>}
    </div>
  );
}

/** Fades content in once it scrolls into view. No-op (always visible) with prefers-reduced-motion. */
export function Reveal({ children, className, delay = 0, as: Tag = 'div' }: { children: ReactNode; className?: string; delay?: number; as?: 'div' | 'li' }) {
  const ref = useRef<HTMLElement | null>(null);
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') {
      setInView(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setInView(true);
          io.disconnect();
        }
      },
      { rootMargin: '0px 0px -8% 0px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <Tag
      ref={(n: HTMLElement | null) => {
        ref.current = n;
      }}
      className={clsx('reveal', inView && 'is-in', className)}
      style={delay ? { transitionDelay: `${delay}ms` } : undefined}
    >
      {children}
    </Tag>
  );
}

/** Product screenshot in a minimal browser window with registration marks and a figure caption. */
export function BrowserFrame({ shot, fig, eager, className }: { shot: Shot; fig?: string; eager?: boolean; className?: string }) {
  const host = siteConfig.siteUrl.replace(/^https?:\/\//, '');
  return (
    <figure className={clsx('min-w-0', className)}>
      <div className="reg-marks">
        <div className="overflow-hidden rounded-lg border border-line-strong bg-panel shadow-[0_30px_60px_-30px_rgb(var(--ink)/0.35),0_12px_24px_-16px_rgb(var(--ink)/0.25)]">
          <div className="flex h-8 items-center gap-3 border-b border-line bg-raised/70 px-3 sm:h-9">
            <div className="flex gap-1.5" aria-hidden>
              <span className="h-2.5 w-2.5 rounded-full bg-line-strong" />
              <span className="h-2.5 w-2.5 rounded-full bg-line-strong" />
              <span className="h-2.5 w-2.5 rounded-full bg-line-strong" />
            </div>
            <div className="mx-auto flex h-5 min-w-0 max-w-[420px] flex-1 items-center justify-center truncate rounded-sm border border-line bg-panel px-2 font-mono text-[11px] text-faint">
              <span className="hidden truncate sm:inline">{host}</span>
              {shot.path}
            </div>
            <div className="w-[42px]" aria-hidden />
          </div>
          <img
            src={shot.src}
            alt={shot.alt}
            width={shot.w}
            height={shot.h}
            loading={eager ? 'eager' : 'lazy'}
            decoding="async"
            {...(eager ? { fetchpriority: 'high' } : {})}
            className="block h-auto w-full"
          />
        </div>
      </div>
      {fig && <FigCaption fig={fig}>{shot.caption}</FigCaption>}
    </figure>
  );
}

export function PhoneFrame({ shot, fig, className, marks = true }: { shot: Shot; fig?: string; className?: string; marks?: boolean }) {
  return (
    <figure className={clsx('mx-auto w-full max-w-[280px]', className)}>
      <div className={clsx(marks && 'reg-marks')}>
        <div className="overflow-hidden rounded-[28px] border-[6px] border-[rgb(var(--ink))] bg-[rgb(var(--ink))] shadow-[0_30px_60px_-30px_rgb(var(--ink)/0.5)]">
          <img src={shot.src} alt={shot.alt} width={shot.w} height={shot.h} loading="lazy" decoding="async" className="block h-auto w-full rounded-[22px]" />
        </div>
      </div>
      {fig && <FigCaption fig={fig}>{shot.caption}</FigCaption>}
    </figure>
  );
}

function FigCaption({ fig, children }: { fig: string; children: ReactNode }) {
  return (
    <figcaption className="mt-4 flex items-center gap-3 font-mono text-[11px] uppercase tracking-[0.14em] text-faint">
      <span className="text-accent">Fig. {fig}</span>
      <span className="h-px flex-1 bg-line" aria-hidden />
      <span className="truncate">{children}</span>
    </figcaption>
  );
}

const ICONS: Record<FeatureIcon, LucideIcon> = {
  cad: PenTool,
  calc: Calculator,
  cut: Ruler,
  nest: LayoutGrid,
  qr: QrCode,
  cart: ShoppingCart,
  report: FileText,
  offline: CloudOff,
  shield: ShieldCheck,
  server: Server,
};

export const SOLUTION_ICONS: Record<SolutionKey, LucideIcon> = {
  'design-calculation': PenTool,
  'cutting-nesting': Ruler,
  'production-tracking': QrCode,
  'purchasing-quotes': ShoppingCart,
};

export function IconTile({ icon, Icon, className }: { icon?: FeatureIcon; Icon?: LucideIcon; className?: string }) {
  const I = Icon ?? ICONS[icon ?? 'cad'];
  return (
    <span className={clsx('inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-accent/25 bg-accent/[0.07] text-accent', className)} aria-hidden>
      <I className="h-[18px] w-[18px]" strokeWidth={1.75} />
    </span>
  );
}

export function TextLink({ to, children, className }: { to: string; children: ReactNode; className?: string }) {
  return (
    <Link to={to} className={clsx('group inline-flex items-center gap-1.5 text-[15px] font-medium text-accent hover:text-[var(--accent-hover)]', className)}>
      {children}
      <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" aria-hidden />
    </Link>
  );
}

/** Dark closing call-to-action band. */
export function CtaBand({ title, text }: { title?: string; text?: string }) {
  return (
    <section className="px-4 pb-20 pt-4 sm:px-8 sm:pb-28" aria-labelledby="cta-title">
      <div className="relative mx-auto max-w-[1200px] overflow-hidden rounded-xl border border-white/10 bg-[rgb(var(--ink))] px-6 py-12 text-white sm:px-12 sm:py-16">
        <div className="bp-grid-dark pointer-events-none absolute inset-0" aria-hidden />
        <div className="relative flex flex-col gap-8 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-[640px]">
            <div className="font-mono text-[12px] uppercase tracking-[0.16em] text-[#67e8f9]">Next step</div>
            <h2 id="cta-title" className="mt-3 text-balance text-3xl font-semibold sm:text-4xl">
              {title ?? 'See FenestrationOS with your own elevations.'}
            </h2>
            <p className="mt-4 text-lg leading-[1.6] text-white/70">
              {text ?? 'Tell us which systems you fabricate and how your team works today. We will walk you through the workflow from drawing to dispatched part.'}
            </p>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row">
            <Link to="/contact" className="site-btn bg-white text-[rgb(var(--ink))] hover:bg-white/90">
              Request a demo <ArrowRight className="h-4 w-4" aria-hidden />
            </Link>
            <a href="/app" className="site-btn border border-white/25 text-white hover:border-white/50 hover:bg-white/5">
              Open the app
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}

/** Honest status note ("demo data shown"). */
export function StatusNote({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <p className={clsx('flex items-start gap-2.5 rounded-md border border-prov/30 bg-prov/[0.07] px-3.5 py-2.5 text-sm text-muted', className)}>
      <span className="mt-[3px] shrink-0 rounded-sm border border-prov/40 px-1 font-mono text-[10px] font-semibold uppercase leading-[14px] tracking-wider text-prov">Demo</span>
      <span>{children}</span>
    </p>
  );
}
