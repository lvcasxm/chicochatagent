import { lazy, Suspense, type ReactNode } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router';
import { ErrorState } from '../components/ErrorState';
import { Skeleton } from '../components/Skeleton';
import { ToastProvider } from '../components/Toast';
import { LoginPage } from '../features/auth/LoginPage';
import { PrivacyNotice } from '../features/auth/PrivacyNotice';
import { ChatPage } from '../features/chat/ChatPage';
import { AuthProvider, useAuth } from './auth/AuthContext';
import { AppShell } from './layouts/AppShell';
import { ThemeProvider } from './theme/ThemeProvider';

// A página de design existe só no desenvolvimento: no build de produção esta linha some
// junto com o chunk dela.
const DesignPage = import.meta.env.DEV
  ? lazy(() => import('../features/design/DesignPage').then((m) => ({ default: m.DesignPage })))
  : null;

/**
 * Protege uma tela: leva ao login quem não entrou (guardando para onde voltar) e bloqueia
 * com o aviso de privacidade quem ainda não o aceitou. Isto só organiza a interface; quem
 * garante o acesso é a API, que recusa o que for pedido sem login ou sem aceite.
 */
function RequireAuth({ children }: { children: ReactNode }) {
  const { state, reload } = useAuth();
  const location = useLocation();

  switch (state.status) {
    case 'loading':
      return (
        <AppShell>
          <div role="status" className="flex max-w-reading flex-col gap-4">
            <span className="sr-only">Carregando…</span>
            <Skeleton className="h-10 w-2/3" />
            <Skeleton className="h-6 w-full" />
            <Skeleton className="h-6 w-5/6" />
          </div>
        </AppShell>
      );
    case 'error':
      return (
        <AppShell>
          <ErrorState
            title="Não foi possível consultar o sistema."
            description="Verifique a sua conexão e tente de novo."
            onRetry={reload}
          />
        </AppShell>
      );
    case 'anonymous': {
      const destination = `${location.pathname}${location.search}`;
      return <Navigate to={`/login?redirect=${encodeURIComponent(destination)}`} replace />;
    }
    case 'authenticated':
      return state.me.privacyAccepted ? children : <PrivacyNotice />;
  }
}

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      {DesignPage && (
        <Route
          path="/_design"
          element={
            <Suspense fallback={null}>
              <DesignPage />
            </Suspense>
          }
        />
      )}
      {/* Compatibilidade com o endereço do sistema anterior. */}
      <Route path="/agent/:slug" element={<Navigate to="/" replace />} />
      <Route
        path="/c/:conversationId"
        element={
          <RequireAuth>
            <ChatPage />
          </RequireAuth>
        }
      />
      <Route
        path="*"
        element={
          <RequireAuth>
            <ChatPage />
          </RequireAuth>
        }
      />
    </Routes>
  );
}

export function App() {
  return (
    <ThemeProvider>
      <ToastProvider>
        <BrowserRouter>
          <AuthProvider>
            <AppRoutes />
          </AuthProvider>
        </BrowserRouter>
      </ToastProvider>
    </ThemeProvider>
  );
}
