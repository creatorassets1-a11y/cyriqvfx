import { Component, StrictMode, Suspense, lazy, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import './styles/app.css';
import { SessionProvider, useSession } from './lib/session';
import { ToastProvider } from './ui/Toast';
import { Button } from './ui/primitives';
import { Colophon, Masthead, ScrollReset } from './components/Chrome';
import { CardGridSkeleton } from './components/ResourceCard';

/**
 * The shell.
 *
 * Every route is loaded on demand. The public pages are what a visitor arrives
 * for, so they are the only thing the first request pays for; the account and
 * owner areas are whole applications of their own that never reach someone who
 * does not open them.
 */

const Home = lazy(() => import('./pages/Home'));
const Library = lazy(() => import('./pages/Library'));
const ResourcePage = lazy(() => import('./pages/ResourcePage'));
const CategoryIndex = lazy(() => import('./pages/CategoryIndex'));
const CategoryPage = lazy(() => import('./pages/CategoryPage'));
const TutorialIndex = lazy(() => import('./pages/TutorialIndex'));
const TutorialPage = lazy(() => import('./pages/TutorialPage'));
const Updates = lazy(() => import('./pages/Updates'));
const About = lazy(() => import('./pages/About'));
const Requests = lazy(() => import('./pages/Requests'));
const ReportProblem = lazy(() => import('./pages/ReportProblem'));
const ShareLink = lazy(() => import('./pages/ShareLink'));
const NotFound = lazy(() => import('./pages/NotFound'));

const SignIn = lazy(() => import('./pages/auth/SignIn'));
const SignUp = lazy(() => import('./pages/auth/SignUp'));
const ForgotPassword = lazy(() => import('./pages/auth/ForgotPassword'));
const ResetPassword = lazy(() => import('./pages/auth/ResetPassword'));
const ConfirmEmail = lazy(() => import('./pages/auth/ConfirmEmail'));

const AccountArea = lazy(() => import('./pages/account/AccountArea'));
const OwnerArea = lazy(() => import('./pages/admin/OwnerArea'));

/** One page failing to render must never take the whole site down with it. */
class Boundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error) {
    // Left in the console rather than swallowed, so the bug stays findable.
    console.error('Render failed:', error);
  }

  render() {
    if (!this.state.failed) return this.props.children;

    return (
      <div className="page flex min-h-[60vh] flex-col items-center justify-center gap-3 text-center">
        <h1 className="text-[24px]">This page hit a problem</h1>
        <p className="max-w-sm text-[14px] leading-relaxed text-text-3">
          Something on this page failed to render. Reloading usually clears it.
        </p>
        <Button variant="primary" icon="refresh" onClick={() => window.location.reload()}>
          Reload the page
        </Button>
      </div>
    );
  }
}

/** Held space while a route's code arrives, shaped like what is coming. */
function RouteFallback() {
  return (
    <div className="page py-10">
      <CardGridSkeleton count={4} />
    </div>
  );
}

/** Sends a signed-out visitor to sign in, remembering where they meant to go. */
function Private({ children, ownerOnly }: { children: ReactNode; ownerOnly?: boolean }) {
  const { user, loading, isAdmin } = useSession();
  const location = useLocation();

  if (loading) return <RouteFallback />;
  if (!user) return <Navigate to="/login" state={{ from: location.pathname }} replace />;
  if (ownerOnly && !isAdmin) return <Navigate to="/" replace />;
  return <>{children}</>;
}

function App() {
  return (
    <>
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <ScrollReset />
      <Masthead />

      <main id="main" tabIndex={-1}>
        <Boundary>
          <Suspense fallback={<RouteFallback />}>
            <Routes>
              <Route path="/" element={<Home />} />
              <Route path="/resources" element={<Library />} />
              <Route path="/resources/:slug" element={<ResourcePage />} />
              <Route path="/categories" element={<CategoryIndex />} />
              <Route path="/categories/:slug" element={<CategoryPage />} />
              <Route path="/tutorials" element={<TutorialIndex />} />
              <Route path="/tutorials/:slug" element={<TutorialPage />} />
              <Route path="/updates" element={<Updates />} />
              <Route path="/about" element={<About />} />
              <Route path="/requests" element={<Requests />} />
              <Route path="/report" element={<ReportProblem />} />
              <Route path="/download/:token" element={<ShareLink />} />

              <Route path="/login" element={<SignIn />} />
              <Route path="/register" element={<SignUp />} />
              <Route path="/forgot-password" element={<ForgotPassword />} />
              <Route path="/reset-password" element={<ResetPassword />} />
              <Route path="/verify-email" element={<ConfirmEmail />} />

              <Route
                path="/account/*"
                element={
                  <Private>
                    <AccountArea />
                  </Private>
                }
              />
              <Route
                path="/admin/*"
                element={
                  <Private ownerOnly>
                    <OwnerArea />
                  </Private>
                }
              />

              <Route path="*" element={<NotFound />} />
            </Routes>
          </Suspense>
        </Boundary>
      </main>

      <Colophon />
    </>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <SessionProvider>
        <ToastProvider>
          <App />
        </ToastProvider>
      </SessionProvider>
    </BrowserRouter>
  </StrictMode>,
);
