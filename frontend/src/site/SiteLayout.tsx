import clsx from 'clsx';
import { ArrowRight, ChevronDown, Menu, Moon, Sun, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet, ScrollRestoration, useLocation } from 'react-router-dom';
import { useTheme } from '../store/theme';
import { SOLUTIONS } from './content';
import { siteConfig } from './siteConfig';
import { Container, SOLUTION_ICONS } from './ui';

export function Logo({ className }: { className?: string }) {
  return (
    <Link to="/" className={clsx('flex min-w-0 shrink-0 items-center gap-2.5 rounded-sm', className)} aria-label={`${siteConfig.productName} — home`}>
      <svg width="28" height="28" viewBox="0 0 32 32" aria-hidden className="shrink-0">
        <rect x="3" y="3" width="26" height="26" rx="2" fill="none" stroke="rgb(var(--accent))" strokeWidth="2.2" />
        <path d="M16 3v26M3 16h13" stroke="rgb(var(--accent))" strokeWidth="2.2" />
        <rect x="18.5" y="18.5" width="8" height="8" fill="rgb(var(--accent) / 0.25)" />
      </svg>
      <span className="truncate text-[16px] font-semibold tracking-tight text-fg">
        <span className="text-muted">ITMC</span> FenestrationOS
      </span>
    </Link>
  );
}

function ThemeToggle() {
  const { theme, toggle } = useTheme();
  return (
    <button
      type="button"
      onClick={toggle}
      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-muted transition-colors hover:bg-hover hover:text-fg"
      aria-label={theme === 'light' ? 'Switch to dark theme' : 'Switch to light theme'}
      data-testid="site-theme-toggle"
    >
      {theme === 'light' ? <Moon className="h-[18px] w-[18px]" /> : <Sun className="h-[18px] w-[18px]" />}
    </button>
  );
}

const navCls = ({ isActive }: { isActive: boolean }) =>
  clsx('flex h-9 items-center rounded-md px-3 text-[15px] transition-colors', isActive ? 'text-fg' : 'text-muted hover:text-fg');

function SolutionsMenu() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  // a mouse hover opens the menu; the click that usually follows must not immediately close it again
  const hoverOpenedAt = useRef(0);
  const loc = useLocation();
  const active = loc.pathname.startsWith('/solutions');
  useEffect(() => setOpen(false), [loc.pathname]);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        ref.current?.querySelector('button')?.focus();
      }
    };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);
  return (
    <div ref={ref} className="relative" onMouseLeave={() => setOpen(false)}>
      <button
        type="button"
        className={clsx('flex h-9 items-center gap-1 rounded-md px-3 text-[15px] transition-colors', active || open ? 'text-fg' : 'text-muted hover:text-fg')}
        aria-expanded={open}
        aria-controls="solutions-menu"
        onClick={() => {
          if (Date.now() - hoverOpenedAt.current < 500) setOpen(true);
          else setOpen((v) => !v);
        }}
        onMouseEnter={() =>
          setOpen((v) => {
            if (!v) hoverOpenedAt.current = Date.now();
            return true;
          })
        }
        data-testid="nav-solutions"
      >
        Solutions <ChevronDown className={clsx('h-4 w-4 transition-transform', open && 'rotate-180')} aria-hidden />
      </button>
      {open && (
        <div id="solutions-menu" className="absolute left-1/2 top-full z-50 w-[560px] -translate-x-1/2 pt-2">
          <div className="animate-fade-in overflow-hidden rounded-lg border border-line-strong bg-panel shadow-[0_24px_48px_-20px_rgb(var(--ink)/0.35)]">
            <ul className="grid grid-cols-2 gap-1 p-2">
              {SOLUTIONS.map((s) => {
                const I = SOLUTION_ICONS[s.key];
                return (
                  <li key={s.key}>
                    <Link to={`/solutions/${s.key}`} className="flex gap-3 rounded-md p-3 transition-colors hover:bg-hover" data-testid={`menu-${s.key}`}>
                      <I className="mt-0.5 h-[18px] w-[18px] shrink-0 text-accent" strokeWidth={1.75} aria-hidden />
                      <span>
                        <span className="block text-sm font-semibold text-fg">{s.title}</span>
                        <span className="mt-0.5 block text-[13px] leading-[18px] text-muted">{s.summary}</span>
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
            <Link to="/solutions" className="flex items-center justify-between border-t border-line bg-raised/50 px-5 py-3 text-sm font-medium text-fg hover:text-accent">
              All solutions and how they connect <ArrowRight className="h-4 w-4" aria-hidden />
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}

function MobileMenu({ onClose }: { onClose: () => void }) {
  return (
    <div id="mobile-menu" className="animate-fade-in border-t border-line bg-bg lg:hidden" data-testid="mobile-menu">
      <Container className="max-h-[calc(100dvh-64px)] overflow-y-auto py-4">
        <div className="font-mono text-[11px] uppercase tracking-[0.16em] text-faint">Solutions</div>
        <ul className="mt-2">
          {SOLUTIONS.map((s) => {
            const I = SOLUTION_ICONS[s.key];
            return (
              <li key={s.key}>
                <Link to={`/solutions/${s.key}`} onClick={onClose} className="flex h-12 items-center gap-3 border-b border-line text-[16px] text-fg">
                  <I className="h-[18px] w-[18px] text-accent" strokeWidth={1.75} aria-hidden /> {s.title}
                </Link>
              </li>
            );
          })}
          {[
            ['/solutions', 'All solutions'],
            ['/pricing', 'Pricing'],
            ['/about', 'About'],
            ['/contact', 'Contact'],
          ].map(([to, label]) => (
            <li key={to}>
              <Link to={to} onClick={onClose} className="flex h-12 items-center border-b border-line text-[16px] text-fg">
                {label}
              </Link>
            </li>
          ))}
        </ul>
        <div className="mt-5 grid grid-cols-2 gap-3 pb-2">
          <a href="/app" className="site-btn site-btn-secondary">
            Log in
          </a>
          <Link to="/contact" onClick={onClose} className="site-btn site-btn-primary">
            Request a demo
          </Link>
        </div>
      </Container>
    </div>
  );
}

function Header() {
  const [mobile, setMobile] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const loc = useLocation();
  useEffect(() => setMobile(false), [loc.pathname]);
  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 4);
    on();
    window.addEventListener('scroll', on, { passive: true });
    return () => window.removeEventListener('scroll', on);
  }, []);
  return (
    <header className={clsx('sticky top-0 z-40 border-b backdrop-blur-md transition-colors', scrolled || mobile ? 'border-line bg-bg/85' : 'border-transparent bg-bg/60')} data-testid="site-header">
      <Container className="flex h-16 items-center gap-2">
        <Logo />
        <nav aria-label="Main" className="ml-8 hidden items-center gap-0.5 lg:flex">
          <SolutionsMenu />
          <NavLink to="/pricing" className={navCls}>
            Pricing
          </NavLink>
          <NavLink to="/about" className={navCls}>
            About
          </NavLink>
          <NavLink to="/contact" className={navCls}>
            Contact
          </NavLink>
        </nav>
        <div className="ml-auto flex items-center gap-1.5 sm:gap-2">
          <ThemeToggle />
          <a href="/app" className="site-btn site-btn-sm hidden text-muted hover:bg-hover hover:text-fg sm:inline-flex" data-testid="site-login">
            Log in
          </a>
          <Link to="/contact" className="site-btn site-btn-sm site-btn-primary hidden sm:inline-flex" data-testid="site-demo">
            Request a demo
          </Link>
          <button
            type="button"
            className="flex h-10 w-10 items-center justify-center rounded-md text-fg hover:bg-hover lg:hidden"
            aria-expanded={mobile}
            aria-controls="mobile-menu"
            aria-label={mobile ? 'Close menu' : 'Open menu'}
            onClick={() => setMobile((v) => !v)}
            data-testid="site-menu-toggle"
          >
            {mobile ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
      </Container>
      {mobile && <MobileMenu onClose={() => setMobile(false)} />}
    </header>
  );
}

function Footer() {
  const year = new Date().getFullYear();
  const col = (title: string, links: [string, string, boolean?][]) => (
    <div>
      <h2 className="font-mono text-[11px] font-medium uppercase tracking-[0.16em] text-faint">{title}</h2>
      <ul className="mt-4 space-y-2.5">
        {links.map(([to, label, external]) => (
          <li key={to + label}>
            {external ? (
              <a href={to} className="text-sm text-muted transition-colors hover:text-fg">
                {label}
              </a>
            ) : (
              <Link to={to} className="text-sm text-muted transition-colors hover:text-fg">
                {label}
              </Link>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
  return (
    <footer className="border-t border-line bg-panel" data-testid="site-footer">
      <Container className="grid gap-10 py-14 sm:grid-cols-2 lg:grid-cols-[1.6fr_1fr_1fr_1fr]">
        <div className="max-w-[320px]">
          <Logo />
          <p className="mt-4 text-sm leading-[1.6] text-muted">Fenestration CAD, engineering calculation, optimisation and production tracking in one connected system.</p>
          <a href={`mailto:${siteConfig.contactEmail}`} className="site-link mt-4 inline-block text-sm text-fg" data-testid="footer-email">
            {siteConfig.contactEmail}
          </a>
        </div>
        {col('Product', [
          ['/solutions', 'Overview'],
          ['/pricing', 'Pricing'],
          ['/contact', 'Request a demo'],
          ['/app', 'Log in', true],
        ])}
        {col(
          'Solutions',
          SOLUTIONS.map((s) => [`/solutions/${s.key}`, s.title] as [string, string]),
        )}
        {col('Company', [
          ['/about', 'About'],
          ['/contact', 'Contact'],
          ['/privacy', 'Privacy'],
          ['/terms', 'Terms'],
        ])}
      </Container>
      <div className="border-t border-line">
        <Container className="flex flex-col gap-2 py-5 text-[13px] text-faint sm:flex-row sm:items-center sm:justify-between">
          <span>
            © {year} {siteConfig.companyName}. All rights reserved.
          </span>
          <span className="font-mono text-[11px] uppercase tracking-[0.14em]">Designed &amp; engineered for façade fabricators</span>
        </Container>
      </div>
    </footer>
  );
}

export function SiteLayout() {
  return (
    <div className="site relative flex min-h-screen flex-col overflow-x-clip bg-bg text-fg">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-3 focus:z-50 focus:rounded-md focus:bg-panel focus:px-3 focus:py-2 focus:shadow-pop">
        Skip to content
      </a>
      <Header />
      <main id="main" className="flex-1">
        <Outlet />
      </main>
      <Footer />
      <ScrollRestoration />
    </div>
  );
}
