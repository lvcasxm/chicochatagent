import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router';
import type { ReactNode } from 'react';
import { LoginPage } from '../features/auth/LoginPage';
import { PrivacyNotice } from '../features/auth/PrivacyNotice';
import { HomePage } from '../features/home/HomePage';
import { AuthProvider, useAuth } from './auth/AuthContext';

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
      return <p role="status">Carregando…</p>;
    case 'error':
      return (
        <main>
          <p role="alert">Não foi possível consultar o sistema.</p>
          <button type="button" onClick={reload}>
            Tentar novamente
          </button>
        </main>
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
      <Route
        path="*"
        element={
          <RequireAuth>
            <HomePage />
          </RequireAuth>
        }
      />
    </Routes>
  );
}

export function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </BrowserRouter>
  );
}
