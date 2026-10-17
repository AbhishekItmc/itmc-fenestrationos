import { lazy, Suspense } from 'react';
import { createBrowserRouter, Navigate, RouterProvider } from 'react-router-dom';
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
      { path: '*', element: <Navigate to="/projects" replace /> },
    ],
  },
], {
  future: { v7_relativeSplatPath: true, v7_fetcherPersist: true, v7_normalizeFormMethod: true, v7_partialHydration: true, v7_skipActionErrorRevalidation: true },
});

export function App() {
  const phase = useApp((s) => s.phase);
  return (
    <>
      {phase === 'checking' || phase === 'choose' ? <Startup /> : phase === 'login' ? <LoginPage /> : <RouterProvider router={router} future={{ v7_startTransition: true }} />}
      <Toaster />
    </>
  );
}
