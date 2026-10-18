import { lazy, Suspense, type ReactNode } from 'react';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import HomePage from './pages/HomePage';
import { SiteLayout } from './SiteLayout';

// The home page ships in the website entry chunk; everything else loads on demand.
const SolutionsPage = lazy(() => import('./pages/SolutionsPage'));
const SolutionPage = lazy(() => import('./pages/SolutionPage'));
const PricingPage = lazy(() => import('./pages/PricingPage'));
const AboutPage = lazy(() => import('./pages/AboutPage'));
const ContactPage = lazy(() => import('./pages/ContactPage'));
const LegalPage = lazy(() => import('./pages/LegalPage'));
const NotFoundPage = lazy(() => import('./pages/NotFoundPage'));

const L = ({ children }: { children: ReactNode }) => <Suspense fallback={<div className="min-h-[60vh]" aria-busy="true" />}>{children}</Suspense>;

const router = createBrowserRouter(
  [
    {
      path: '/',
      element: <SiteLayout />,
      children: [
        { index: true, element: <HomePage /> },
        { path: 'solutions', element: <L><SolutionsPage /></L> },
        { path: 'solutions/:key', element: <L><SolutionPage /></L> },
        { path: 'pricing', element: <L><PricingPage /></L> },
        { path: 'about', element: <L><AboutPage /></L> },
        { path: 'contact', element: <L><ContactPage /></L> },
        { path: 'privacy', element: <L><LegalPage kind="privacy" /></L> },
        { path: 'terms', element: <L><LegalPage kind="terms" /></L> },
        { path: '*', element: <L><NotFoundPage /></L> },
      ],
    },
  ],
  { future: { v7_relativeSplatPath: true, v7_fetcherPersist: true, v7_normalizeFormMethod: true, v7_partialHydration: true, v7_skipActionErrorRevalidation: true } },
);

export default function SiteApp() {
  return <RouterProvider router={router} future={{ v7_startTransition: true }} />;
}
