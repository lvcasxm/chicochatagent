import { useState } from 'react';
import { useAuth } from '../../app/auth/AuthContext';

/** Página inicial provisória: o chat entra na F4. Confirma que o login funciona de ponta a ponta. */
export function HomePage() {
  const { state, signOut } = useAuth();
  const [failed, setFailed] = useState(false);

  if (state.status !== 'authenticated') return null;
  const firstName = state.me.fullName.split(' ')[0];

  async function leave() {
    setFailed(false);
    try {
      await signOut();
    } catch {
      setFailed(true);
    }
  }

  return (
    <main>
      <h1>ChicoChat+</h1>
      <p>Olá, {firstName}. O atendimento por chat chega na próxima etapa.</p>
      {failed && <p role="alert">Não foi possível sair agora. Tente novamente.</p>}
      <button type="button" onClick={() => void leave()}>
        Sair
      </button>
    </main>
  );
}
