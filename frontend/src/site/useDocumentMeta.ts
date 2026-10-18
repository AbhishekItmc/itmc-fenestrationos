import { useEffect } from 'react';
import { siteConfig } from './siteConfig';

function setMeta(attr: 'name' | 'property', key: string, content: string) {
  let el = document.head.querySelector<HTMLMetaElement>(`meta[${attr}="${key}"]`);
  if (!el) {
    el = document.createElement('meta');
    el.setAttribute(attr, key);
    document.head.appendChild(el);
  }
  el.setAttribute('content', content);
}

/** Full document title for a page ("Pricing · ITMC FenestrationOS"; the home page passes null for the bare name). */
export function pageTitle(title: string | null): string {
  return title ? `${title} · ${siteConfig.productName}` : `${siteConfig.productName} — Fenestration CAD, engineering and manufacturing`;
}

/** Per-page <title>, meta description, Open Graph title/description/url and canonical link. */
export function useDocumentMeta(title: string | null, description: string) {
  useEffect(() => {
    const full = pageTitle(title);
    document.title = full;
    setMeta('name', 'description', description);
    setMeta('property', 'og:title', full);
    setMeta('property', 'og:description', description);
    const url = `${siteConfig.siteUrl}${window.location.pathname === '/' ? '/' : window.location.pathname}`;
    setMeta('property', 'og:url', url);
    let link = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
    if (!link) {
      link = document.createElement('link');
      link.rel = 'canonical';
      document.head.appendChild(link);
    }
    link.href = url;
  }, [title, description]);
}
