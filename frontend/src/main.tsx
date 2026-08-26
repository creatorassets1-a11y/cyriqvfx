import { StrictMode, Suspense, lazy, Component, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Route, Routes, Navigate, useLocation } from 'react-router-dom';
import './styles/app.css';
import { AuthProvider, useAuth } from './lib/auth';
import { ToastProvider, Button } from './components/ui';
import { Footer, Header, ScrollReset } from './components/Layout';
import { ResourceCardSkeleton } from './components/ResourceCard';

/**
 * Route-based code splitting (PRD §5). The home and library routes are the
 * common entry points; account and admin bundles never reach a visitor who
 * does not open them.
 */
const Home = lazy(() => import('./pages/Home'));
const Resources = lazy(() => import('./pages/Resources'));
const ResourceDetail = lazy(() => import('./pages/ResourceDetail'));
const Categories = lazy(() => import('./pages/Categories'));
const CategoryDetail = lazy(() => import('./pages/CategoryDetail'));
const Tutorials = lazy(() => import('./pages/Tutorials'));
const TutorialDetail = lazy(() => import('./pages/TutorialDetail'));
const Updates = lazy(() => import('./pages/Updates'));
const About = lazy(() => import('./pages/About'));
const Requests = lazy(() => import('./pages/Requests'));
const Report = lazy(() => import('./pages/Report'));
const DownloadPage = lazy(() => import('./pages/DownloadPage'));
const NotFound = lazy(() => import('./pages/NotFound'));

const Login = lazy(() => import('./pages/auth/Login'));
const Register = lazy(() => import('./pages/auth/Register'));
const ForgotPassword = lazy(() => import('./pages/auth/ForgotPassword'));
const ResetPassword = lazy(() => import('./pages/auth/ResetPassword'));
const VerifyEmail = lazy(() => import('./pages/auth/VerifyEmail'));

const Account = lazy(() => import('./pages/account/Account'));
const Admin = lazy(() => import('./pages/admin/Admin'));

/** Catches render errors so one broken page never blanks the whole site. */
class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error) {
    // Kept in the console rather than swallowed, so a bug is still findable.
    console.error('Render error:', error);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="page flex min-h-[60vh] flex-col items-center justify-center gap-3 text-center">
          <h1 className="text-[22px] font-semibold">This page hit a problem</h1>
          <p className="max-w-sm text-[14px] text-soft">
            Something in the page failed to render. Reloading usually clears it.
          </p>
          <Button variant="primary" icon="refresh" onClick={() => window.location.reload()}>
            Reload the page
          </Button>
        </div>
      );
    }
    return this.props.children;
  }
}

function RouteFallback() {
  return (
    <div className="page py-10">
      <div className="grid grid-cols-1 gap-4 min-[560px]:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <ResourceCardSkeleton key={i} />
        ))}
      </div>
    </div>
  );
}

/** Sends a signed-out visitor to sign in, remembering where they were headed. */
function RequireAuth({ children, adminOnly }: { children: ReactNode; adminOnly?: boolean }) {
  const { user, loading, isAdmin } = useAuth();
  const location = useLocation();

  if (loading) return <RouteFallback />;
  if (!user) return <Navigate to="/login" state={{ from: location.pathname }} replace />;
  if (adminOnly && !isAdmin) return <Navigate to="/" replace />;
  return <>{children}</>;
}

function App() {
  return (
    <>
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <ScrollReset />
      <Header />
      <main id="main" tabIndex={-1}>
        <ErrorBoundary>
          <Suspense fallback={<RouteFallback />}>
            <Routes>
              <Route path="/" element={<Home />} />
              <Route path="/resources" element={<Resources />} />
              <Route path="/resources/:slug" element={<ResourceDetail />} />
              <Route path="/categories" element={<Categories />} />
              <Route path="/categories/:slug" element={<CategoryDetail />} />
              <Route path="/tutorials" element={<Tutorials />} />
              <Route path="/tutorials/:slug" element={<TutorialDetail />} />
              <Route path="/updates" element={<Updates />} />
              <Route path="/about" element={<About />} />
              <Route path="/requests" element={<Requests />} />
              <Route path="/report" element={<Report />} />
              <Route path="/download/:token" element={<DownloadPage />} />

              <Route path="/login" element={<Login />} />
              <Route path="/register" element={<Register />} />
              <Route path="/forgot-password" element={<ForgotPassword />} />
              <Route path="/reset-password" element={<ResetPassword />} />
              <Route path="/verify-email" element={<VerifyEmail />} />

              <Route
                path="/account/*"
                element={
                  <RequireAuth>
                    <Account />
                  </RequireAuth>
                }
              />
              <Route
                path="/admin/*"
                element={
                  <RequireAuth adminOnly>
                    <Admin />
                  </RequireAuth>
                }
              />

              <Route path="*" element={<NotFound />} />
            </Routes>
          </Suspense>
        </ErrorBoundary>
      </main>
      <Footer />
    </>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <ToastProvider>
          <App />
        </ToastProvider>
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
);
