import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { PRIVACY_NOTICE_VERSION, type MeResponse } from '@chicochat/shared';
import { acceptPrivacy, fetchMe, logout } from '../../lib/api';

export type AuthState =
  | { status: 'loading' }
  | { status: 'anonymous' }
  | { status: 'error' }
  | { status: 'authenticated'; me: MeResponse };

interface AuthContextValue {
  state: AuthState;
  /** Consulta o servidor de novo, por exemplo depois de uma falha. */
  reload: () => void;
  /** Registra o aceite do aviso de privacidade atual. Rejeita se o servidor recusar. */
  acceptPrivacyNotice: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

/**
 * Guarda quem está logado. A verdade está no servidor: aqui só se pergunta `GET /api/me`,
 * e nada é decidido pelo navegador (a interface apenas esconde o que a API recusaria).
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);

  // O estado inicial já é "carregando"; um recarregamento o recoloca em `reload`, e não aqui.
  useEffect(() => {
    const controller = new AbortController();
    fetchMe(controller.signal).then(
      (me) => setState(me ? { status: 'authenticated', me } : { status: 'anonymous' }),
      (error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        setState({ status: 'error' });
      },
    );
    return () => controller.abort();
  }, [attempt]);

  const reload = useCallback(() => {
    setState({ status: 'loading' });
    setAttempt((value) => value + 1);
  }, []);

  const acceptPrivacyNotice = useCallback(async () => {
    await acceptPrivacy(PRIVACY_NOTICE_VERSION);
    setState((current) =>
      current.status === 'authenticated'
        ? { status: 'authenticated', me: { ...current.me, privacyAccepted: true } }
        : current,
    );
  }, []);

  const signOut = useCallback(async () => {
    await logout();
    setState({ status: 'anonymous' });
  }, []);

  const value = useMemo(
    () => ({ state, reload, acceptPrivacyNotice, signOut }),
    [state, reload, acceptPrivacyNotice, signOut],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth precisa estar dentro de AuthProvider');
  return value;
}
