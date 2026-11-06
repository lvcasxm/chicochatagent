import { LogOut } from 'lucide-react';
import { useState } from 'react';
import { useAuth } from '../../app/auth/AuthContext';
import { AppShell } from '../../app/layouts/AppShell';
import { Button } from '../../components/Button';
import { Notice } from '../../components/Notice';

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
    <AppShell
      actions={
        <Button
          variant="ghost"
          iconStart={<LogOut className="size-5" />}
          onClick={() => void leave()}
        >
          Sair
        </Button>
      }
    >
      <div className="flex max-w-reading flex-col items-start gap-6">
        <h1 className="type-title-2">ChicoChat+</h1>
        <p className="type-lead text-fg-muted">
          Olá, {firstName}. O atendimento por chat chega na próxima etapa.
        </p>
        {failed && <Notice tone="danger">Não foi possível sair agora. Tente novamente.</Notice>}
      </div>
    </AppShell>
  );
}
