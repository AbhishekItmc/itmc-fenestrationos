import { lazy, Suspense, useState } from 'react';
import { createBrowserRouter, MemoryRouter, Navigate, RouterProvider } from 'react-router-dom';
import { LoginPage } from './features/auth/LoginPage';
import { Startup } from './features/auth/Startup';
import { EditorPage } from './features/editor/EditorPage';
import { Shell } from './layout/Shell';
import { useApp } from './store/app';
import { LoadingBlock } from './ui/Misc';
import { Toaster } from './ui/Toaster';

const ProjectsPage = lazy(() => import('./features/projects/ProjectsPage'));
const ProjectDetailPage = lazy(() => import('./features/projects/ProjectDetailPage'));
const CataloguePage = lazy(() => import('./features/catalogue/CataloguePage'));
const GlassPage = lazy(() => import('./features/glass/GlassPage'));
const CalcPage = lazy(() => import('./features/calc/CalcPage'));
const CuttingPage = lazy(() => import('./features/cutting/CuttingPage'));
const NestingPage = lazy(() => import('./features/nesting/NestingPage'));
const InventoryPage = lazy(() => import('./features/inventory/InventoryPage'));
const QuotesPage = lazy(() => import('./features/quotes/QuotesPage'));
const ReportsPage = lazy(() => import('./features/reports/ReportsPage'));
const AdminPage = lazy(() => import('./features/admin/AdminPage'));
const ProductionPage = lazy(() => import('./features/production/ProductionPage'));
const LabelsPage = lazy(() => import('./features/production/LabelsPage'));
const StationPage = lazy(() => import('./features/production/StationPage'));
const PartPage = lazy(() => import('./features/production/PartPage'));
const PurchasingPage = lazy(() => import('./features/purchasing/PurchasingPage'));

const S = ({ children }: { children: React.ReactNode }) => <Suspense fallback={<LoadingBlock />}>{children}</Suspense>;

const router = createBrowserRouter([
  {
    path: '/',
    element: <Shell />,
    children: [
      { index: true, element: <Navigate to="/projects" replace /> },
      { path: 'projects', element: <S><ProjectsPage /></S> },
      { path: 'projects/:projectId', element: <S><ProjectDetailPage /></S> },
      { path: 'editor', element: <EditorPage /> },
      { path: 'editor/:elevationId', element: <EditorPage /> },
      { path: 'catalogue', element: <S><CataloguePage /></S> },
      { path: 'glass', element: <S><GlassPage /></S> },
      { path: 'calc', element: <S><CalcPage /></S> },
      { path: 'cutting', element: <S><CuttingPage /></S> },
      { path: 'nesting', element: <S><NestingPage /></S> },
      { path: 'inventory', element: <S><InventoryPage /></S> },
      { path: 'quotes', element: <S><QuotesPage /></S> },
      { path: 'reports', element: <S><ReportsPage /></S> },
      { path: 'admin', element: <S><AdminPage /></S> },
      { path: 'production', element: <S><ProductionPage /></S> },
      { path: 'production/:orderId', element: <S><ProductionPage /></S> },
      { path: 'station', element: <S><StationPage /></S> },
      { path: 'p/:code', element: <S><PartPage /></S> },
      { path: 'purchasing', element: <S><PurchasingPage /></S> },
      { path: '*', element: <Navigate to="/projects" replace /> },
    ],
  },
  // print-optimised, outside the app chrome
  { path: '/production/:orderId/labels', element: <S><LabelsPage /></S> },
], {
  future: { v7_relativeSplatPath: true, v7_fetcherPersist: true, v7_normalizeFormMethod: true, v7_partialHydration: true, v7_skipActionErrorRevalidation: true },
});

const isPartUrl = () => typeof window !== 'undefined' && window.location.pathname.startsWith('/p/');

export function App() {
  const phase = useApp((s) => s.phase);
  const [signIn, setSignIn] = useState(false);
  let body: React.ReactNode;
  if (phase === 'checking' || phase === 'choose') body = <Startup />;
  else if (phase === 'login')
    // a scanned QR opened on a device that is not signed in: show the part (if the server allows) before the login
    body = isPartUrl() && !signIn ? (
      <MemoryRouter>
        <S>
          <PartPage publicView onSignIn={() => setSignIn(true)} />
        </S>
      </MemoryRouter>
    ) : (
      <LoginPage />
    );
  else body = <RouterProvider router={router} future={{ v7_startTransition: true }} />;
  return (
    <>
      {body}
      <Toaster />
    </>
  );
}
